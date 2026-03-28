// cxx/compare.mjs
import { createRequire } from "node:module"
import { setFlagsFromString } from "node:v8"
import { section, renderCXXSection, divider } from "../bench-render.mjs"
const require = createRequire(import.meta.url)
const v8   = require("./build/v8.node")
const napi = require("./build/napi.node")

setFlagsFromString("--allow-natives-syntax")
var internalDetach = new Function('buf', '%ArrayBufferDetach(buf)')

// For the sake of result's speed measurement, code below is ommitted
// Expose as if it were the proposal's API
ArrayBuffer.prototype.detach = function() { internalDetach(this) }
const ITERATIONS =  2_000_000;
v8.setIterations(ITERATIONS)
napi.setIterations(ITERATIONS)

// ─── shared callback ───────────────────────────────────────────────────────

const cb = (ab) => { Buffer.from(ab).toString(); }
const cbDetach = (ab) => { Buffer.from(ab).toString(); internalDetach(ab); }

// ─── timing helper ─────────────────────────────────────────────────────────

function time(fn) {
  const t0 = Date.now();
  fn();
  return (Date.now() - t0) / 1000; // return seconds
}

// ─── V8 API ────────────────────────────────────────────────────────────────

  const iterStr = ITERATIONS >= 1e6
    ? (ITERATIONS / 1e6) + 'M'
    : (ITERATIONS / 1e3) + 'K';
section('cxx', `${iterStr} iterations · 10 KB static buffer`);

v8.setLoopAutoDetach(cb);
const v8Warmup    = time(() => v8.loopAutoDetach());
v8.setLoopManualDetach((ab) => { Buffer.from(ab).toString(); v8.manualDetach(ab); });
const v8Manual    = time(() => v8.loopManualDetach());

v8.setLoopManualDetach(cbDetach);
const v8Auto1     = time(() => v8.loopAutoDetach());
const v8Detach1   = time(() => v8.loopManualDetach());
const v8Auto2     = time(() => v8.loopAutoDetach());
const v8Detach2   = time(() => v8.loopManualDetach());


v8.setLoopManualDetach((ab) => { Buffer.from(ab).toString(); });
const v8NoDetch   = time(() => v8.loopManualDetach());
v8.unload()


renderCXXSection('V8 API', [
  { label: 'warmup',                    ms: v8Warmup,  isWarmup: true },
  { label: 'C++ detach via JS call',    ms: v8Manual,  isManualJsCall: true },
  { label: 'C++ detach after callback', ms: v8Auto1,   isAutoDetach: true },
  { label: 'internalDetach()',          ms: v8Detach1 },
  { label: 'C++ detach after cb (2nd)', ms: v8Auto2,   isAutoDetach: true },
  { label: 'internalDetach() (2nd)',    ms: v8Detach2 },
  { label: 'no detach',                 ms: v8NoDetch, isNoDetach: true },
], v8NoDetch);


// ─── NAPI ──────────────────────────────────────────────────────────────────

divider();

napi.setLoopAutoDetach(cb);
napi.setLoopManualDetach(cbDetach);

const napiDetach1 = time(() => napi.loopManualDetach());

napi.setLoopManualDetach((ab) => { Buffer.from(ab).toString(); napi.manualDetach(ab); });
const napiManual  = time(() => napi.loopManualDetach());

const napiAuto    = time(() => napi.loopAutoDetach());


napi.setLoopManualDetach((ab) => { Buffer.from(ab).toString(); });
const napiNoDetach = time(() => napi.loopManualDetach());


renderCXXSection('NAPI', [
  { label: 'internalDetach', ms: napiDetach1 },
  { label: 'C++ detach via JS call',  ms: napiManual },
  { label: 'C++ detach after cb', ms: napiAuto },
  { label: 'no detach', ms: napiNoDetach, isNoDetach: true },
], napiNoDetach);

setFlagsFromString("--no-allow-natives-syntax")
