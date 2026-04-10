// gc-pressure/index.mjs
//
//   docker run --memory=300m --memory-swap=300m --rm gc-pressure
//   docker run --memory=300m --memory-swap=300m --rm -e variant=detach gc-pressure
//   docker run --memory=300m --memory-swap=300m --rm -e variant=transfer gc-pressure transfer
//   docker run --memory=300m --memory-swap=300m --rm -e variant=no-discard gc-pressure

import { performance, PerformanceObserver } from 'node:perf_hooks';
import { setFlagsFromString } from "node:v8"
import { section, note, divider, stat, yellow, dim, red, green } from "/test/helpers.mjs"

setFlagsFromString("--allow-natives-syntax")
var internalDetach = new Function('buf', '%ArrayBufferDetach(buf)')

// For the sake of result's speed measurement, code below is ommitted
// Expose as if it were the proposal's API
ArrayBuffer.prototype.detach = function() { internalDetach(this) }


// ─── config ────────────────────────────────────────────────────────────────

var variant = process.argv[2];
var variants = new Set(["detach", "transfer", "no-discard", "all"])
if (!variant) variant = "all";
else if (!variants.has(variant)) {
  throw new Error("pass option 'detach' or 'transfer' or 'no-discard', or don't pass to run all")
}

const ITERATIONS  = 2000;
const ALLOC_BYTES = 50 * 1024 * 1024;
const PAGE        = 4096;

// ─── GC observer ───────────────────────────────────────────────────────────

var gcEvents = [];
const GC_KINDS = {
  //Clean up short-lived objects quickly.
  1: 'Scavenge',
  //Deep cleaning of long-lived memory.
  2: 'MarkSweepCompact',
  //Spread out the marking work to avoid freezes.
  4: 'IncrementalMarking',
  //Finalize and clean up weakly held objects.
  8: 'WeakCallbacks',
};
const obs = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    gcEvents.push({
      kind: GC_KINDS[entry.detail?.kind] ?? `kind(${entry.detail?.kind})`,
      duration: entry.duration,
    });
  }
});

// ─── helpers ───────────────────────────────────────────────────────────────

function rss() { return parseFloat((process.memoryUsage().rss / 1024 / 1024).toFixed(1)); }

function allocAndWalk() {
  const buf = Buffer.allocUnsafe(ALLOC_BYTES);
  for (let i = 0; i < ALLOC_BYTES; i += PAGE) buf[i] = 1;
  return buf;
}

// ─── warmup ────────────────────────────────────────────────────────────────

{ const warm = allocAndWalk(); warm.buffer.transfer(0); gc(); }

// ─── benchmark variants ────────────────────────────────────────────────────

var buf;
const options = {
  "transfer": () => {
    for (let i = 0; i < ITERATIONS; i++) { buf = allocAndWalk(); buf.buffer.transfer(0); }
  },
  "no-discard": () => {
    for (let i = 0; i < ITERATIONS; i++) { buf = allocAndWalk(); }
  },
  "detach": () => {
    for (let i = 0; i < ITERATIONS; i++) { buf = allocAndWalk(); internalDetach(buf.buffer); }
  },
}

// ─── runner ────────────────────────────────────────────────────────────────

function renderGCResult({ variant, wallMs, totalGCms, gcEvents, gcByKind, rssBefore, rssAfter }) {
  const gcPct   = (totalGCms / wallMs * 100).toFixed(1);
  const rssGain = (rssAfter - rssBefore).toFixed(1);
  const isClean = gcEvents.length === 0;
  const isBad   = gcEvents.length > 10;

  console.log('');
  const tag = isClean ? green(' ✔ ') : isBad ? red(' ✘ ') : yellow(' ~ ');
  console.log(` ${tag} ${bold(variant)}`);

  stat('RSS',        `${rssBefore} MB → ${rssAfter} MB  (${rssGain > 0 ? '+' : ''}${rssGain} MB)`,
       { color: rssGain > 50 ? 'red' : 'green' });
  stat('Wall time',  wallMs.toFixed(1) + ' ms');
  stat('GC time',    totalGCms.toFixed(1) + ' ms  (' + gcPct + '% of wall)',
       { color: isBad ? 'red' : isClean ? 'green' : 'dim' });
  stat('GC events',  gcEvents.length.toString(),
       { color: isBad ? 'red' : isClean ? 'green' : 'dim' });

  if (gcEvents.length > 0) {
    stat('Avg pause',  (totalGCms / gcEvents.length).toFixed(1) + ' ms');
    stat('Max pause',  Math.max(...gcEvents.map(e => e.duration)).toFixed(1) + ' ms');
    console.log('');
    console.log(dim('  Breakdown:'));
    for (const [kind, { count, totalMs }] of Object.entries(gcByKind)) {
      console.log(dim(`    ${pad(kind, 22)} ${lpad(count, 4)} events   ${lpad(totalMs.toFixed(1), 8)} ms`));
    }
  } else {
    console.log(dim('  (no GC events — backing store freed before GC was needed)'));
  }
}
async function run(name, benchmark) {
  gcEvents = [];
  obs.observe({ type: "gc" });
  const rssBefore = rss();
  const t0 = performance.now();
  benchmark();
  const wallMs = performance.now() - t0;
  await new Promise(r => setTimeout(r, 50));
  obs.disconnect();
  const rssAfter   = rss();
  const totalGCms  = gcEvents.reduce((s, e) => s + e.duration, 0);
  const gcByKind   = {};
  for (const e of gcEvents) {
    gcByKind[e.kind] ??= { count: 0, totalMs: 0 };
    gcByKind[e.kind].count++;
    gcByKind[e.kind].totalMs += e.duration;
  }
  renderGCResult({ variant: name, wallMs, totalGCms, gcEvents, gcByKind, rssBefore, rssAfter });
}

// ─── entry ─────────────────────────────────────────────────────────────────

section('gc-pressure', `${ITERATIONS} iterations · ${ALLOC_BYTES / 1024 / 1024} MB buffers · Docker 300 MB`);

if (variant !== "all") {
  await run(variant, options[variant]);
} else {
  await run("transfer",   options["transfer"]);
  divider();
  await run("detach",     options["detach"]);
  divider();
  await run("no discard", options["no-discard"]);
}

note(`Notice that 'detach' triggered 'Scavenge' event or nothing, 'transfer(0)' - 'IncrementalMarking', 'no discard' - WeakCallbacks and IncrementalMarking. Brief description:
 'Scavenge' — clean up short-lived objects quickly.
 'MarkSweepCompact' — deep cleaning of long-lived memory.
 'IncrementalMarking' — spread out the marking work to avoid freezes.
 'WeakCallbacks' — finalize and clean up weakly held objects.`)
