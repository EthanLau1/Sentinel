#!/bin/zsh
set -e

# 仓库根目录从脚本自身位置推导 —— 不要写死本机绝对路径：
# 写死的话，别人克隆下来直接双击会 cd 到不存在的目录；
# 而且公开仓库里会暴露使用者的本机目录结构。
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if command -v bun >/dev/null 2>&1; then
  bun packages/cli/src/index.ts ui
else
  echo "bun not found. Please install bun first."
  exit 1
fi
