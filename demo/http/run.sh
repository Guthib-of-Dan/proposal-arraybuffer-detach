#!/usr/bin/env bash
node demo/http/node_http.mjs &
SERVER_PID=$!

trap "kill $SERVER_PID 2>/dev/null || true" EXIT INT TERM

sleep 1
echo "test node:http"
k6 --quiet run demo/http/k6.ts
kill $SERVER_PID 2>/dev/null || true
echo "test bun (equal results expected for .transfer(0))"
bun demo/http/bun.mjs &
SERVER_PID=$!
sleep 1
k6 --quiet run demo/http/k6.ts
kill $SERVER_PID 2>/dev/null || true
