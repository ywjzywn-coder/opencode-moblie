#!/bin/bash
# start.sh - 本地模式一键启动
#
# 启动 4 个服务:
#   1. Relay    - WebSocket 中继服务器 (端口 4097)
#   2. opencode  - opencode serve HTTP API (端口 4096)
#   3. Daemon    - 连接 relay + opencode 的守护进程
#   4. PWA       - Vite 开发服务器 (端口 5173)
#
# 用法: ./start.sh
# 停止: Ctrl+C

set -e
cd "$(dirname "$0")"
export PATH="$HOME/.hermes/node/bin:$HOME/.opencode/bin:$PATH"

RELAY_PORT=4097
PWA_PORT=5173
OPENCODE_PORT=4096

# 从 .relay-state.json 读取 token (首次运行 relay 时自动生成)
USER_TOKEN=$(node -e "const s=require('./.relay-state.json');console.log(s.userToken)")
MACHINE_TOKEN=$(node -e "const s=require('./.relay-state.json');console.log(s.machines[0].machineToken)")

# 生成 opencode serve 密码 (每次启动随机)
OC_PASSWORD="oc-remote-$(openssl rand -hex 6 2>/dev/null || echo auto123)"

echo "════════════════════════════════════════════"
echo "  opencode-remote 启动中..."
echo "════════════════════════════════════════════"
echo ""
echo "  User Token:    $USER_TOKEN"
echo "  Machine Token: $MACHINE_TOKEN"
echo ""

# 清理旧进程
pkill -f "relay/dist/cli" 2>/dev/null || true
pkill -f "opencode serve --port $OPENCODE_PORT" 2>/dev/null || true
pkill -f "plugin/dist/daemon" 2>/dev/null || true
pkill -f "vite.*$PWA_PORT" 2>/dev/null || true
sleep 1

# 1. 启动中继服务器
echo "[1/4] 启动中继服务器 (端口 $RELAY_PORT)..."
node packages/relay/dist/cli.js > /tmp/oc-remote-relay.log 2>&1 &
RELAY_PID=$!
sleep 1.5

# 2. 启动 opencode serve (本地 HTTP API)
echo "[2/4] 启动 opencode (端口 $OPENCODE_PORT)..."
OPENCODE_SERVER_PASSWORD="$OC_PASSWORD" opencode serve --port $OPENCODE_PORT --hostname 127.0.0.1 > /tmp/oc-remote-opencode.log 2>&1 &
OC_PID=$!
sleep 4

# 3. 启动 daemon (连接 opencode + 中继)
echo "[3/4] 启动 daemon 守护进程..."
export OPENCODE_REMOTE_RELAY_URL="ws://127.0.0.1:$RELAY_PORT"
export OPENCODE_REMOTE_MACHINE_TOKEN="$MACHINE_TOKEN"
export OPENCODE_REMOTE_MACHINE_NAME="$(hostname)"
export OPENCODE_SERVER_PASSWORD="$OC_PASSWORD"
node packages/plugin/dist/daemon.js > /tmp/oc-remote-daemon.log 2>&1 &
DAEMON_PID=$!
sleep 2

# 4. 启动 PWA 开发服务器
echo "[4/4] 启动 PWA (端口 $PWA_PORT)..."
pnpm --filter @opencode-remote/pwa dev > /tmp/oc-remote-pwa.log 2>&1 &
PWA_PID=$!
sleep 3

# 获取局域网 IP
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost")

echo ""
echo "════════════════════════════════════════════"
echo "  ✅ 全部启动成功！"
echo "════════════════════════════════════════════"
echo ""
echo "  📱 手机浏览器打开:"
echo "     http://$LAN_IP:$PWA_PORT"
echo ""
echo "  🔑 在 PWA 里输入:"
echo "     中继地址: ws://$LAN_IP:$RELAY_PORT"
echo "     User Token: $USER_TOKEN"
echo ""
echo "  📋 日志位置:"
echo "     中继:    /tmp/oc-remote-relay.log"
echo "     opencode: /tmp/oc-remote-opencode.log"
echo "     daemon:  /tmp/oc-remote-daemon.log"
echo "     PWA:     /tmp/oc-remote-pwa.log"
echo ""
echo "  ⏹️  按 Ctrl+C 停止全部"
echo "════════════════════════════════════════════"

# 优雅退出
cleanup() {
  echo ""
  echo "正在停止..."
  kill $RELAY_PID $OC_PID $DAEMON_PID $PWA_PID 2>/dev/null || true
  pkill -f "relay/dist/cli" 2>/dev/null || true
  pkill -f "opencode serve --port $OPENCODE_PORT" 2>/dev/null || true
  pkill -f "plugin/dist/daemon" 2>/dev/null || true
  pkill -f "vite.*$PWA_PORT" 2>/dev/null || true
  echo "已停止"
}
trap cleanup EXIT INT TERM

wait
