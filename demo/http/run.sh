#!/usr/bin/env bash
set -euo pipefail

CONTAINER_ID=""

cleanup() {
  echo "Cleaning up..."
  if [[ -n "$CONTAINER_ID" ]]; then
    docker stop "$CONTAINER_ID" >/dev/null 2>&1 || true
  fi
}

trap cleanup INT TERM EXIT

run_test() {
  local name=$1
  local image=$2
  local port=$3

  echo "test $name"

  CONTAINER_ID=$(docker run -d \
    --rm \
    --memory=300m \
    --memory-swap=300m \
    -p ${port}:8080\
    "$image")

  # wait for server to be ready (better than sleep if you want later)
  sleep 2

  k6 --quiet run demo/http/k6.ts

  docker stop -t 0 $CONTAINER_ID >/dev/null
  docker wait $CONTAINER_ID 2>/dev/null || true
  CONTAINER_ID=""
}

run_test "node:http" "bench-node" 8080 
run_test "bun (equal results expected for .transfer(0))" "bench-bun" 8080
run_test "deno (equal results expected for .transfer(0))" "bench-deno" 8080
