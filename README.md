# opencode-remote

用手机控制电脑上的 [opencode](https://opencode.ai) —— 就像 ChatGPT 手机版控制 Codex 一样。

采用 **daemon 守护进程** + **中继服务器** + **PWA** 架构。daemon 主动连接中继，直接调用 SDK client 处理 RPC 请求，并转发所有事件（权限请求、消息更新、会话状态）到手机。

## 架构

```
┌─────────┐         ┌──────────┐         ┌────────────────────┐
│  手机   │◄──WS────│  中继    │◄──WS────│  daemon + opencode  │
│  (PWA)  │         │ (本机)   │         │  (本机)             │
└─────────┘         └──────────┘         └────────────────────┘
```

- **中继** (`packages/relay`)：WebSocket 服务器。单用户鉴权、机器名册、RPC 路由、事件广播。同时提供 PWA 静态文件服务。
- **daemon** (`packages/plugin`)：Node 守护进程。连接 opencode serve HTTP API + 中继 WS，作为 RPC 代理转发请求和事件。
- **PWA** (`packages/pwa`)：React + Vite PWA。基于 WebSocket 的 RPC 传输层 + SDK 代理。可安装到手机主屏幕。

## 快速开始

### 前置要求

- Node 20+
- 已安装 opencode
- pnpm

### 1. 安装依赖

```bash
pnpm install
```

### 2. 构建

```bash
pnpm build
```

### 3. 启动

```bash
./start.sh
```

首次启动会自动生成 User Token 并打印到终端，后续启动会复用。

### 4. 手机操作

1. 手机浏览器打开终端显示的局域网地址（如 `http://192.168.x.x:5173`）
2. 输入 User Token（终端日志里）
3. 选择你的电脑
4. 创建会话、发送消息、审批权限、查看 diff

添加到主屏幕即可像原生 App 一样使用。

## 项目结构

```
opencode-remote/
├── packages/
│   ├── shared/          # WS 协议类型定义
│   ├── relay/           # 中继服务器
│   ├── plugin/          # daemon 守护进程
│   └── pwa/             # 手机 PWA
├── start.sh             # 一键启动脚本
├── .relay-state.json    # （自动生成，已 gitignore）
└── package.json
```

## 命令

```bash
pnpm build              # 构建全部
pnpm typecheck          # 类型检查
./start.sh              # 启动全部服务
```

## 功能

- 项目文件夹归类（按目录自动分组）
- 机器名称可修改（内联编辑）
- 会话管理（创建、列表、删除）
- 流式聊天（实时输出）
- 权限审批（实时推送到手机）
- 模型 / Agent 选择器
- 文件附加（搜索 + 附加文件）
- 思考过程展示（可开关）
- Diff 查看器（查看文件改动）
- PWA 可安装

## 安全

- 中继仅监听局域网，不暴露到公网
- 单用户 token + 每机器独立 token（配对机制）
- `.relay-state.json` 包含 token，已 gitignore

## License

MIT
