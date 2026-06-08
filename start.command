#!/bin/bash
# Sentinel — 一键启动
# macOS: 双击此文件即可启动 Sentinel WebUI
# 终端: ./start.command

set -e

# 定位到脚本所在目录（即 Sentinel 根目录）
cd "$(dirname "$0")"

echo "🛰  Sentinel — Starting..."
echo ""

# 1. 检查 bun
if ! command -v bun &> /dev/null; then
  echo "❌ 未检测到 bun。请先安装 bun："
  echo ""
  echo "   curl -fsSL https://bun.sh/install | bash"
  echo ""
  echo "   安装完成后重新运行此文件。"
  echo ""
  read -n 1 -s -r -p "按任意键退出..."
  exit 1
fi

echo "✓ bun $(bun --version)"

# 2. 安装依赖
echo ""
echo "📦 安装依赖..."
bun install

# 3. 构建 WebUI（如果 dist 不存在）
if [ ! -f "sentinel-ui/dist/index.html" ]; then
  echo ""
  echo "🔨 构建 WebUI..."
  npm --workspace sentinel-ui run build
fi

# 4. 启动 WebUI（会自动打开浏览器）
echo ""
echo "🚀 启动 Sentinel Console..."
echo "   浏览器会自动打开 http://127.0.0.1:4317"
echo "   按 Ctrl+C 停止"
echo ""
bun packages/cli/src/index.ts ui
