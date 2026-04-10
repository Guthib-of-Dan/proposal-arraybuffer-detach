#!/usr/bin/env bash
node demo/node:http/server.mjs &
SERVER_PID=$!

trap "kill $SERVER_PID 2>/dev/null || true" EXIT INT TERM

sleep 2
k6 --quiet run demo/node:http/k6.ts
