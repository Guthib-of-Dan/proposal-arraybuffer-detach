#!/usr/bin/env bash
set -euo pipefail

node demo/node:http/server.mjs &
SERVER_PID=$!

trap "kill $SERVER_PID 2>/dev/null || true" EXIT INT TERM

sleep 2
k6 run demo/node:http/k6.ts
