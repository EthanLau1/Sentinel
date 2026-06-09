#!/bin/bash
# Sentinel — 双击启动
# 每次双击这个文件，WebUI 在后台运行，关掉终端也不受影响。
# 再次双击会自动打开已运行的 WebUI（不会重复启动）。

set -e
cd "$(dirname "$0")"

PORT=4317

# 检查 bun
if ! command -v bun &> /dev/null; then
  echo "❌ 未检测到 bun。请先安装："
  echo "   curl -fsSL https://bun.sh/install | bash"
  read -n 1 -s -r -p "按任意键退出..."
  exit 1
fi

# 首次：安装依赖
[ -d "node_modules" ] || bun install

# 首次：构建 UI
[ -f "sentinel-ui/dist/index.html" ] || npm --workspace sentinel-ui run build

# 检查是否已在运行
if curl -s "http://127.0.0.1:$PORT/api/bootstrap" > /dev/null 2>&1; then
  echo "🛰  Sentinel 已在运行中"
  echo "   打开 http://127.0.0.1:$PORT"
  open "http://127.0.0.1:$PORT"
  exit 0
fi

# 后台启动 server
echo "🚀 Starting Sentinel Console (background)..."
nohup bun packages/cli/src/index.ts ui --no-open > /tmp/sentinel-server.log 2>&1 &
SERVER_PID=$!
echo $SERVER_PID > /tmp/sentinel-server.pid

# 等待 server 就绪
for i in $(seq 1 20); do
  if curl -s "http://127.0.0.1:$PORT/api/bootstrap" > /dev/null 2>&1; then
    echo "✓ Sentinel Console running (PID: $SERVER_PID)"
    echo "   http://127.0.0.1:$PORT"
    echo ""
    echo "   关闭方式: 双击 stop.command"
    open "http://127.0.0.1:$PORT"
    exit 0
  fi
  sleep 0.5
done

echo "⚠  Server 启动超时，查看日志: /tmp/sentinel-server.log"
exit 1
