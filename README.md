# opencode-remote

用手机控制电脑上的 [opencode](https://opencode.ai) —— 类似 ChatGPT 手机版控制 Codex。

**LAN-only**，不走公网：手机 PWA 经本机 WebSocket 中继，调用电脑上的 `opencode serve`。

仓库：https://github.com/ywjzywn-coder/opencode-moblie（历史拼写 `moblie`）

## 架构

```
手机 PWA (5173)  --WS-->  relay (4097)  --WS-->  daemon (plugin)
                                                      |
                                               HTTP / SSE
                                                      v
                                              opencode serve (4096)

panel (4099)  负责 spawn / 停止上述服务，并提供控制 UI + 配对二维码
```

| 包 | 作用 |
|----|------|
| `packages/shared` | WebSocket 协议类型 |
| `packages/relay` | 鉴权、机器名册、RPC 路由、事件广播；可托管 PWA 静态资源 |
| `packages/plugin` | daemon：连 serve + relay，转发 RPC 与按目录订阅的 SSE |
| `packages/pwa` | React + Vite 手机端 |
| `packages/panel` | 进程管理 + 控制面板（推荐启动方式） |

## 前置要求

- Node 20+
- [pnpm](https://pnpm.io)
- 已安装 [opencode](https://opencode.ai)，且在 `PATH` 中

本机常用 PATH（按需调整）：

```bash
export PATH="$HOME/.hermes/node/bin:$HOME/.opencode/bin:$PATH"
```

## 快速开始

```bash
git clone git@github.com:ywjzywn-coder/opencode-moblie.git
cd opencode-moblie

CI=true pnpm install --no-frozen-lockfile
CI=true pnpm -r build

# 推荐：控制面板一键起 4 个服务
node packages/panel/dist/index.js
# 或: pnpm panel
```

打开控制面板：**http://localhost:4099**

- 查看服务状态、启停
- 扫二维码配对手机（含 LAN IP + User Token）
- 每次启动会生成随机 `OPENCODE_SERVER_PASSWORD`，自动传给 serve 与 daemon

### 手机

1. 扫 panel 二维码，或浏览器打开 `http://<电脑局域网IP>:5173`
2. 自动配对；也可手动输入中继地址 `ws://<IP>:4097` 与 User Token
3. 选电脑 → 项目 → 会话 → 聊天
4. Safari「添加到主屏幕」可当 PWA 用

配对码格式：`http://<LAN_IP>:5173/#pair=<base64url({relayUrl,userToken})>`

### 旧版启动

```bash
./start.sh
```

功能类似，日志在 `/tmp`，无控制 UI。首次需已有 `.relay-state.json` 中的 machine token（panel / 新版 relay 会自动创建）。

## 端口

| 服务 | 端口 |
|------|------|
| opencode serve | 4096 |
| relay | 4097 |
| panel | 4099 |
| PWA (Vite dev) | 5173 |

## 功能

- 项目按目录分组、会话列表 / 创建 / 删除
- 流式回复（SSE → relay → 手机）；跨项目会话按 `directory` 多路订阅事件
- 权限审批、模型 / Agent 选择、文件附加、思考过程开关
- Diff 查看
- 顶栏上下文用量（当前上下文 token；≥150K 黄 / ≥180K 红）
- 发送 45s 无结束提示「响应较慢」
- 列表隐藏 subagent 子会话（`parent_id` 非空）
- 断线自动重连；机器名可改

## 命令

```bash
CI=true pnpm install --no-frozen-lockfile
CI=true pnpm -r build
CI=true pnpm -r typecheck

pnpm panel                          # 启动控制面板
pnpm dev:relay / pnpm dev:pwa       # 单独开发
```

## 安全

- 仅局域网使用，默认不暴露公网
- User Token + 每台机器 Machine Token（`.relay-state.json`，已 gitignore）
- opencode serve 使用随机 Basic Auth 密码（由 panel 注入）

## 已知限制

- 超大会话（数百条消息）响应慢，建议新建会话
- iPhone PWA 更新后有时需彻底杀掉进程再开
- 桌面 OpenCode App 与 `opencode serve` 共用数据库；手机侧事件以 serve 的 SSE 为准

## 开发

详细坑位、事件结构、验收方式见 **[AGENTS.md](./AGENTS.md)**（给 AI / 接手开发者）。

要点摘要：

- 事件必须用原始 SSE 读 `/event`（及 `?directory=`），不要用 SDK `event.subscribe()` + 自定义 fetch
- 所有 session RPC 带 `query: { directory }`
- `promptAsync` 可能返回 `{ error }` 而不 throw，需显式检查
- commit 信息格式：`type: 中文描述`

## License

MIT
