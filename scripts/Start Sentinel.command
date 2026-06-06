#!/bin/zsh
set -e

ROOT="/Users/ethan/Library/Mobile Documents/com~apple~CloudDocs/Downloads/Sentinel"
cd "$ROOT"

if command -v bun >/dev/null 2>&1; then
  bun packages/cli/src/index.ts ui
else
  echo "bun not found. Please install bun first."
  exit 1
fi
