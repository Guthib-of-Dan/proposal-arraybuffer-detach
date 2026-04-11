# syntax=docker/dockerfile:1

FROM node:24-slim AS node
WORKDIR /app
COPY demo/http/node_http.mjs .
CMD ["node", "node_http.mjs"]

FROM oven/bun:1.3.12-slim AS bun
WORKDIR /app
COPY demo/http/bun.mjs .
CMD ["bun", "bun.mjs"]

FROM denoland/deno:alpine-2.7.12 AS deno
WORKDIR /app
COPY demo/http/deno.mjs .
CMD ["deno", "run", "--allow-net", "deno.mjs"]
