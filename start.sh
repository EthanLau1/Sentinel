#!/bin/bash
# Sentinel — Linux 启动脚本
#
# 与 start.command 同源，但不含 macOS 专属内容：
#   - 不写死 /opt/homebrew（那是 Apple Silicon macOS 的路径）
#   - 不用 `open`（Linux 没有），改用 xdg-open，并允许手动开
#
# 用法：./start.sh

set -e
cd "$(dirname "$0")"

PORT=4317
LOG=/tmp/sentinel-server.log

# 检查 bun
if ! command -v bun &> /dev/null; then
  echo "❌ 未检测到 bun。请先安装："
  echo "   curl -fsSL https://bun.sh/install | bash"
  exit 1
fi

# 首次：安装依赖
[ -d "node_modules" ] || bun install

# 首次：构建 UI
[ -f "sentinel-ui/dist/index.html" ] || bun run build

# 浏览器依赖必须进安装流程（幂等：已装则秒退）
if ! bun run setup > /tmp/sentinel-playwright.log 2>&1; then
  echo "⚠  Chromium 未安装（离线或网络不通时会失败）"
  echo "   装好再跑: bun run setup"
  echo "   日志: /tmp/sentinel-playwright.log"
fi

open_browser() {
  if command -v xdg-open &> /dev/null; then
    xdg-open "$1" > /dev/null 2>&1 || true
  else
    echo "   请手动在浏览器打开: $1"
  fi
}

# 检查是否已在运行
if curl -s "http://127.0.0.1:$PORT/api/bootstrap" > /dev/null 2>&1; then
  echo "🛰  Sentinel 已在运行中"
  echo "   http://127.0.0.1:$PORT"
  open_browser "http://127.0.0.1:$PORT"
  exit 0
fi

# 后台启动 server
echo "🚀 Starting Sentinel Console (background)..."
nohup bun packages/cli/src/index.ts ui --no-open > "$LOG" 2>&1 &
SERVER_PID=$!
echo $SERVER_PID > /tmp/sentinel-server.pid

# 等待 server 就绪
for i in $(seq 1 20); do
  if curl -s "http://127.0.0.1:$PORT/api/bootstrap" > /dev/null 2>&1; then
    echo "✓ Sentinel Console running (PID: $SERVER_PID)"
    echo "   http://127.0.0.1:$PORT"
    echo ""
    echo "   关闭方式: kill \$(cat /tmp/sentinel-server.pid)"
    open_browser "http://127.0.0.1:$PORT"
    exit 0
  fi
  sleep 0.5
done

echo "⚠  Server 启动超时，查看日志: $LOG"
exit 1
