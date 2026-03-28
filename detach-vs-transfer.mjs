/**
 * Run this file like this
 * node detach-vs-transfer.mjs 1mil
 * node detach-vs-transfer.mjs 1000k
 * node detach-vs-transfer.mjs 1000000
 */
import { setFlagsFromString } from "node:v8"
import { performance } from "node:perf_hooks"
import { renderDetachVsTransfer } from "./bench-render.mjs"

setFlagsFromString("--allow-natives-syntax")

function parse(str) {
  if (str.endsWith('mil')) return parseFloat(str) * 1e6;
  if (str.endsWith('k'))   return parseFloat(str) * 1e3;
  return Number(str);
}

var internalDetach = new Function('buf', '%ArrayBufferDetach(buf)')
// Expose as if it were the proposal's API
ArrayBuffer.prototype.detach = function() { internalDetach(this) }

var iterations = process.argv[2] ? parse(process.argv[2]) : 2_000_000;

// ─── transfer(0) warmup ────────────────────────────────────────────────────
var t0 = performance.now();
for (var i = iterations; i > 0; i--) new ArrayBuffer(2).transfer(0);
var transferWarmup = performance.now() - t0;

// ─── detach() ──────────────────────────────────────────────────────────────
t0 = performance.now();
for (var i = iterations; i > 0; i--) new ArrayBuffer(2).detach();
var detachMs = performance.now() - t0;


// ─── transfer(0) warmed ────────────────────────────────────────────────────
t0 = performance.now();
for (var i = iterations; i > 0; i--) new ArrayBuffer(2).transfer(0);
var transferMs = performance.now() - t0;

// ─── internalDetach without overhead ───────────────────────────────────────
t0 = performance.now();
for (var i = iterations; i > 0; i--) internalDetach(new ArrayBuffer(2))
var internalDetachMs = performance.now() - t0;

// ─── render ────────────────────────────────────────────────────────────────
renderDetachVsTransfer({ iterations, transferWarmup, detachMs: Math.min(detachMs, internalDetachMs), transferMs });
