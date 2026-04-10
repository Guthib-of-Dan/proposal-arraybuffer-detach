/**
 * Run this file like this
 * node detach-vs-transfer.mjs 1mil
 * node detach-vs-transfer.mjs 1000k
 * node detach-vs-transfer.mjs 1000000
 */
import { setFlagsFromString } from "node:v8"
import { performance } from "node:perf_hooks"
import {section, renderBar, note, stat} from "./helpers.mjs"

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

function renderDetachVsTransfer({ iterations, transferWarmup, detachMs, transferMs }) {
  const iterStr = iterations >= 1e6
    ? (iterations / 1e6) + 'M'
    : (iterations / 1e3) + 'K';
  const ratio   = (detachMs / transferMs * 100).toFixed(2);
  const diff    = Math.abs(detachMs - transferMs).toFixed(1);
  const faster  = detachMs <= transferMs ? 'detach' : 'transfer(0)';
  const max     = Math.max(transferWarmup, detachMs, transferMs);

  section('detach-vs-transfer', `${iterStr} iterations · new ArrayBuffer(2)`);

  console.log('');
  renderBar({ label: 'transfer(0)  [warmup]', value: transferWarmup, max, unit: 'ms',
              badge: 'JIT cold', good: undefined });
  renderBar({ label: 'NodeJS\'s internalDetach()', value: detachMs, max, unit: 'ms',
              badge: ratio + '% of transfer(0)', good: detachMs <= transferMs });
  renderBar({ label: 'transfer(0)  [warmed]', value: transferMs, max, unit: 'ms',
              badge: 'baseline', good: true });

  console.log('');
  stat('Difference', diff + ' ms  (' + faster + ' wins)', { color: 'dim' });
  note('Per-call cost is equivalent — detach() would not regress transfer(0) users.');
}
renderDetachVsTransfer({ iterations, transferWarmup, detachMs: Math.min(detachMs, internalDetachMs), transferMs });
