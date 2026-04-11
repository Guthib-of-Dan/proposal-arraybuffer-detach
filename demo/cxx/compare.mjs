// cxx/compare.mjs
import { createRequire } from "node:module"
import { setFlagsFromString } from "node:v8"
import { section, divider, renderBar, bold, dim, yellow, BoxWidth } from "../helpers.mjs"
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
var v8Warmup    = time(() => v8.loopAutoDetach());
v8.setLoopManualDetach((ab) => { Buffer.from(ab).toString(); v8.manualDetach(ab); });
var v8Manual    = time(() => v8.loopManualDetach());

v8.setLoopManualDetach(cbDetach);
var v8Auto1     = time(() => v8.loopAutoDetach());
var v8Detach1   = time(() => v8.loopManualDetach());
var v8Auto2     = time(() => v8.loopAutoDetach());
var v8Detach2   = time(() => v8.loopManualDetach());




v8.setLoopManualDetach((ab) => { Buffer.from(ab).toString(); });
const v8NoDetch   = time(() => v8.loopManualDetach());


renderCXXSection('V8 API', [
  { label: 'warmup',                    ms: v8Warmup,  isWarmup: true },
  { label: 'C++ detach via JS call',    ms: v8Manual,  isManualJsCall: true },
  { label: 'C++ detach after callback', ms: v8Auto1,   isAutoDetach: true },
  { label: 'internalDetach()',          ms: v8Detach1 },
  { label: 'C++ detach after cb (2nd)', ms: v8Auto2,   isAutoDetach: true },
  { label: 'internalDetach() (2nd)',    ms: v8Detach2 },
  { label: 'no detach',                 ms: v8NoDetch, isNoDetach: true },
], v8NoDetch);

v8.setAsyncCapableLoopManualDetach(cbDetach);

v8.setAsyncCapableLoopAutoDetach(cb);
 v8Warmup    = time(() => v8.asyncCapableLoopAutoDetach());
v8.setAsyncCapableLoopManualDetach((ab) => { Buffer.from(ab).toString(); v8.manualDetach(ab); });
 v8Manual    = time(() => v8.asyncCapableLoopManualDetach());

v8.setAsyncCapableLoopManualDetach(cbDetach);
 v8Auto1     = time(() => v8.asyncCapableLoopAutoDetach());
 v8Detach1   = time(() => v8.asyncCapableLoopManualDetach());
 v8Auto2     = time(() => v8.asyncCapableLoopAutoDetach());
 v8Detach2   = time(() => v8.asyncCapableLoopManualDetach());

renderCXXSection('V8 + node::MakeCallback', [
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

var hasLoggedJSWin = false;
function renderCXXSection(apiName, rows, noDetachMs) {
  console.log(`\n  ${bold(apiName)}`);
  console.log(dim('  ' + '─'.repeat(BoxWidth - 2)));

  const detachRows  = rows.filter(r => !r.isNoDetach && !r.isWarmup);
  const avgDetachMs = detachRows.reduce((a, b) => a + b.ms, 0) / (detachRows.length || 1);

  // Find the auto-detach row (C++ detaches after callback returns)
  // and the manual-JS row (JS calls back into C++ to detach within the frame).
  // We flag it if the JS-call variant beats auto-detach, because that's
  // counterintuitive and worth explaining.
  const autoRow   = rows.find(r => r.isAutoDetach);
  const manualRow = rows.find(r => r.isManualJsCall);
  const jsBeatsCpp = autoRow && manualRow && manualRow.ms < autoRow.ms;
  for (const { label, ms, isWarmup, isNoDetach, isAutoDetach, isManualJsCall } of rows) {
    if (isNoDetach) {
      const mult = (ms / avgDetachMs).toFixed(1);
      renderBar({ label, value: ms, max: noDetachMs, unit: 's',
                  badge: `${mult}× slower than avg detach`,
                  good: false });
    } else if (isWarmup) {
      renderBar({ label: dim(label), value: ms, max: noDetachMs, unit: 's', good: undefined });
    } else {
      // Badge: show % relative to auto-detach when we have one, otherwise plain
      let badge = '';
      if (jsBeatsCpp && isManualJsCall) {
        const pct = ((autoRow.ms - ms) / autoRow.ms * 100).toFixed(1);
        badge = yellow(`${pct}% faster than C++ auto-detach  ⚑`);
      } else if (jsBeatsCpp && isAutoDetach) {
        badge = dim('C++ post-callback detach');
      }
      renderBar({ label, value: ms, max: noDetachMs, unit: 's', good: true, badge });
    }
  }

  // Explanation fires only when the discrepancy is observed
  if (jsBeatsCpp && !hasLoggedJSWin) {
    hasLoggedJSWin = true;
    console.log('');
    console.log(yellow('  ⚑  JS-call detach outpaced C++ auto-detach — why?'));
    console.log(dim('     C++ auto-detach runs after cb->Call() returns: the ArrayBuffer handle'));
    console.log(dim('     is cold by then — register state for that object have'));
    console.log(dim('     already been torn down as the JS frame closed.'));
    console.log(dim('     JS-call detach runs inside the active callback frame: the object is'));
    console.log(dim('     hot in V8\'s inline cache and the C++ addon receives it as a live'));
    console.log(dim('     args[0] handle with no extra lookup cost.'));
    console.log(dim(''));
  }
}

renderCXXSection('NAPI', [
  { label: 'internalDetach', ms: napiDetach1 },
  { label: 'C++ detach via JS call',  ms: napiManual },
  { label: 'C++ detach after cb', ms: napiAuto },
  { label: 'no detach', ms: napiNoDetach, isNoDetach: true },
], napiNoDetach);

setFlagsFromString("--no-allow-natives-syntax")
v8.unload()
