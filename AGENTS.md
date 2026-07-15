# AGENTS.md - opencode-remote 开发交接文档

> 给下一个 AI agent 的上下文文档。读完这个你应该能直接接手开发。

## 项目概述

用手机 PWA 控制电脑上的 opencode -- 类似 ChatGPT 手机版控制 Codex。
LAN-only，不依赖云服务。手机通过 WebSocket 连接本地中继，中继路由 RPC 到 daemon，daemon 调用 opencode serve HTTP API 并转发事件流回手机。

## 架构

```
手机 PWA  <--WS-->  中继 relay  <--WS-->  daemon  <--HTTP/SSE-->  opencode serve
 (5173)            (4097)                  (plugin)              (4096)
                     |
                     +-- 同时提供 PWA 静态文件
```

`packages/panel` 是进程管理器，负责启动/停止/重启上述 4 个服务，并在 localhost:4099 提供控制 UI（含配对二维码）。

## 环境搭建

```bash
# Node 和 opencode 的 PATH（必须）
export PATH="$HOME/.hermes/node/bin:$HOME/.opencode/bin:$PATH"

# 安装依赖（CI 环境无 TTY，需要 --no-frozen-lockfile）
CI=true pnpm install --no-frozen-lockfile

# 构建全部
CI=true pnpm -r build

# 类型检查
CI=true pnpm -r typecheck
```

## 启动方式

### 方式 1：控制面板（推荐）

```bash
# 构建后
node packages/panel/dist/index.js
```

- 自动启动 relay + opencode serve + daemon + PWA dev server
- 控制面板：http://localhost:4099（含二维码配对、服务状态、启停按钮）
- 每次启动生成随机 `OPENCODE_SERVER_PASSWORD`，通过环境变量传给 serve 和 daemon

### 方式 2：start.sh（旧版）

```bash
./start.sh
```

功能相同但日志输出到 /tmp 文件，没有控制 UI。

## 端口分配

| 服务 | 端口 | 说明 |
|------|------|------|
| opencode serve | 4096 | HTTP API + SSE 事件流 |
| relay | 4097 | WebSocket 中继 |
| panel | 4099 | 控制 UI |
| PWA (vite dev) | 5173 | 手机访问入口 |

## 包结构

```
packages/
├── shared/    # WS 协议类型定义（ClientToRelay, RelayToClient, MachineToRelay 等）
├── relay/     # 中继服务器（WS 鉴权、机器名册、RPC 路由、事件广播）
├── plugin/    # daemon 守护进程（连接 opencode serve + relay，转发 RPC 和事件）
├── pwa/       # 手机 PWA（React + Vite，WS 传输层 + RPC 代理客户端）
└── panel/     # 进程管理器（启动/停止 4 个服务，控制 UI + 配对二维码）
```

## 关键文件

### daemon (packages/plugin)
- `src/daemon.ts` -- 主入口。连接 opencode serve + relay，**事件循环**（关键！见下）
- `src/rpc-dispatcher.ts` -- RPC 路由。`db.session.list` 直接查 sqlite（跨所有项目目录），其余透传给 SDK
- `src/relay-connection.ts` -- relay WS 连接管理（注册、RPC 收发、事件推送）
- `src/index.ts` -- opencode 插件入口（hooks 转发事件，与 daemon 二选一，当前用 daemon）

### relay (packages/relay)
- `src/server.ts` -- WS 服务器。客户端 auth、机器 register、RPC 路由、事件广播
  - `broadcastEvent()` (L127): 把 daemon 推来的事件广播给所有已认证客户端
  - `forwardRpc()` (L238): 把客户端 RPC 转发给目标机器
  - heartbeat (L105): `c.ws.ping()` 协议级 ping（不要改成 app-level pong，会断连）

### PWA (packages/pwa)
- `src/lib/relay-transport.ts` -- WS 传输层。自动重连（指数退避）、online/visibilitychange 监听、事件分发
- `src/lib/rpc-client.ts` -- 链式代理 RPC 客户端。`client.db.session.list()` -> relay -> daemon -> sqlite
- `src/lib/store.ts` -- 全局状态。config、pairing 解码、transport/client 管理
- `src/views/ChatView.tsx` -- 聊天界面。**事件解析**（关键！见下）、发送、权限审批
- `src/views/SessionsView.tsx` -- 会话列表。用 `db.session.list` 查所有目录的会话
- `src/views/ProjectsView.tsx` -- 项目列表。按 directory 分组
- `src/styles.css` -- opencode 终端风格主题

### panel (packages/panel)
- `src/index.ts` -- 进程管理器。spawn 4 个服务、HTTP 控制 API
- `src/panel-html.ts` -- 控制 UI（二维码、配对码、状态、启停按钮）

## 关键设计决策与已修复的 Bug

### 1. 事件流：必须用原始 SSE，不能用 SDK subscribe（已修复）

**问题：** daemon 用 `client.event.subscribe()` 订阅 opencode 事件流。但 daemon 给 SDK client 配了自定义 `fetch`（用于加 Basic Auth），SDK 内部重建 Request 时破坏了 SSE 流式响应，导致事件流永远不产出任何事件。手机发消息能到后端、后端能生成回复，但回复推不回手机 -- 表现为"发出去没反应"。

**修复：** daemon 直接用原始 `fetch()` 读 `/event` SSE 端点，手动解析 SSE 块（`daemon.ts` startEventLoop）。带 auth header。带自动重连（断线 1 秒后重连）。

**不要改回 SDK subscribe。** 这是经过大量调试验证的，SDK + 自定义 fetch = SSE 不工作。

### 2. 事件结构：properties 直接带字段，不在 properties.input 里（已修复）

**问题：** ChatView 之前读 `event.properties.input.part` / `.input.messageID` / `.input.sessionID`，但 opencode 实际事件结构是：
```json
{
  "type": "message.part.updated",
  "properties": {
    "sessionID": "ses_xxx",
    "part": { "type": "text", "text": "...", "messageID": "msg_xxx", "sessionID": "ses_xxx", "id": "prt_xxx" }
  }
}
```
`properties.input` 不存在，导致所有事件被丢弃。

**修复：** ChatView 改为读 `event.properties.part` + `event.properties.sessionID`。`messageID` 在 `part.messageID` 里。

### 3. 跨目录会话：所有 session RPC 调用需带 directory 参数

**问题：** `opencode serve` 只认它工作目录下的会话。手机用 `db.session.list`（直接查 sqlite）能列出所有目录的会话，但对不属于 serve 目录的会话调用 `session.promptAsync` 会返回 "Session not found"，而且 `promptAsync` 会把这个错误**静默吞掉**（返回空 `{data:{}}`），导致手机以为发送成功但消息从未落库。

**修复：** 所有 session RPC 调用（messages/promptAsync/abort/command/permission/diff/delete）都带上 `query: { directory }` 参数。directory 从 `db.session.list` 返回的会话数据中获取，经 App.tsx -> ChatView/DiffView 一路传递。`promptAsync` 返回值中的 error 也会显式抛出。

### 4. relay heartbeat：协议级 ping，不要改 app-level

`server.ts` L105 用 `c.ws.ping()`（WebSocket 协议帧），不是 app-level 的 ping/pong。之前用 app-level pong 导致 15 秒后断连。

### 5. db.session.list：直接查 sqlite，绕过 opencode 项目限制

`rpc-dispatcher.ts` 的 `db.session.list` 用 `execSync('sqlite3 -json ...')` 直接查 `~/.local/share/opencode/opencode.db`，返回所有目录的所有会话。opencode 原生的 `session.list` 只返回当前项目的会话，不适合手机端需要展示全部会话的场景。

## 验证方法

### 快速验证（不需要手机）
```bash
# 确保服务已启动（node packages/panel/dist/index.js）
# 然后跑端到端测试脚本：
node -e "
const ws = require('./packages/relay/node_modules/ws');
const c = new ws('ws://127.0.0.1:4097');
let events=0, types={};
c.on('open',()=>c.send(JSON.stringify({type:'auth',token:'1PpXMfs9KUywzajbuIngE1oTOQnEPXxU'})));
c.on('message',d=>{
  const m=JSON.parse(d.toString());
  if(m.type==='auth:ok'){const mid=m.machines[0].id;
    const id='r1';c.send(JSON.stringify({type:'rpc',reqId:id,machineId:mid,method:'session.create',args:{body:{}}}));
  }
  if(m.type==='event'){events++;types[m.event.type]=(types[m.event.type]||0)+1;}
});
setTimeout(()=>{console.log('events:',events,'types:',JSON.stringify(types));process.exit(0);},5000);
"
```

如果 events > 0 且包含 `message.part.updated` 和 `session.idle`，说明事件流正常。

### 手机端验证
1. 手机访问 `http://<LAN_IP>:5173`
2. 输入 User Token 配对
3. 选择一个会话，发消息
4. 应看到：自己消息立即显示、助手回复逐字出现、发完后转圈停止

## 配对机制

- 二维码编码：`http://<LAN_IP>:5173/#pair=<base64url({relayUrl,userToken})>`
- iPhone 原生相机扫描 -> 打开 Safari -> PWA 读取 URL hash 自动配对
- 也可在 SetupView 手动输入配对码或 relay URL + token

## 已知限制

- **巨型会话性能**：超过 500 条消息的会话响应很慢（上下文太大）。建议新建会话而非继续大会话。
- **PWA Service Worker 缓存**：代码更新后手机可能需要彻底关闭重开才能加载新版本。Vite dev server 模式下问题较小。
- **无消息发送超时提示**：发送后如果后端长时间无响应，手机会一直转圈。可考虑加超时。
- **无 token 用量显示**：手机上看不到当前会话的上下文大小，无法提前判断是否过大。

## Git

- 仓库：`git@github.com:ywjzywn-coder/opencode-moblie.git`
- 分支：main
- `git push` 可能首次失败（"Connection closed"），retry 即可
- `.relay-state.json` 含 token，已 gitignore
- commit 消息格式：`type: 中文描述`（feat/fix/cleanup）

## 开发约定

- TypeScript strict mode
- 不加注释（除非用户要求）
- 遵循现有代码风格（单引号、无分号、2 空格缩进）
- 改完必须跑 `CI=true pnpm -r typecheck && CI=true pnpm -r build`
- 不要用 `find`/`grep`/`cat` 命令，用对应工具
