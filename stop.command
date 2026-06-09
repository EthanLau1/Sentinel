#!/bin/bash
# Sentinel — 双击停止后台服务

if [ -f /tmp/sentinel-server.pid ]; then
  PID=$(cat /tmp/sentinel-server.pid)
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID"
    rm -f /tmp/sentinel-server.pid
    echo "✓ Sentinel 已停止 (PID: $PID)"
  else
    rm -f /tmp/sentinel-server.pid
    echo "Sentinel 已经不在运行了"
  fi
else
  echo "Sentinel 没有在运行"
fi
