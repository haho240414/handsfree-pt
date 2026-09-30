#!/bin/bash
# 더블클릭 → 이 컴퓨터에서 핸즈프리 PT 열기 (웹캠 사용). 창을 닫으면 서버도 꺼집니다.
cd "$(dirname "$0")"
PORT=8860
NODE="$(command -v node || true)"
[ -z "$NODE" ] && [ -x "$HOME/.local/bin/node" ] && NODE="$HOME/.local/bin/node"
[ -z "$NODE" ] && [ -x /opt/homebrew/bin/node ] && NODE=/opt/homebrew/bin/node
if [ -z "$NODE" ]; then
  echo "Node.js 가 필요해요: https://nodejs.org 에서 설치한 뒤 다시 실행하세요."
  read -r -p "엔터를 누르면 닫힙니다" _
  exit 1
fi
if lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "이미 켜져 있어요 → 브라우저를 엽니다"
  open "http://localhost:$PORT"
  exit 0
fi
echo "핸즈프리 PT 서버를 켭니다 (이 창을 닫으면 꺼져요)"
( sleep 1; open "http://localhost:$PORT" ) &
exec "$NODE" tools/serve.mjs --port $PORT
