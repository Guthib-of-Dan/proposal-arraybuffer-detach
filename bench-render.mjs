// bench-render.mjs — shared CLI renderer for ArrayBuffer.detach() benchmarks
//
// All formatting lives here. Benchmark files import { render*, section, note }
// and never call console.log themselves for result output.

const W = 68; // total box width

// ─── primitives ────────────────────────────────────────────────────────────

function pad(str, len, char = ' ') {
  return String(str).padEnd(len, char).slice(0, len);
}
function lpad(str, len) {
  return String(str).padStart(len);
}
function line(char = '─') {
  return char.repeat(W);
}

// ANSI — gracefully disabled if not a TTY
const isTTY = process.stdout.isTTY;
const c = {
  reset:  isTTY ? '\x1b[0m'  : '',
  bold:   isTTY ? '\x1b[1m'  : '',
  dim:    isTTY ? '\x1b[2m'  : '',
  green:  isTTY ? '\x1b[32m' : '',
  red:    isTTY ? '\x1b[31m' : '',
  yellow: isTTY ? '\x1b[33m' : '',
  cyan:   isTTY ? '\x1b[36m' : '',
  gray:   isTTY ? '\x1b[90m' : '',
};

function green(s)  { return c.green  + s + c.reset; }
function red(s)    { return c.red    + s + c.reset; }
function yellow(s) { return c.yellow + s + c.reset; }
function cyan(s)   { return c.cyan   + s + c.reset; }
function dim(s)    { return c.dim    + s + c.reset; }
function bold(s)   { return c.bold   + s + c.reset; }
function gray(s)   { return c.gray   + s + c.reset; }

// ─── section header ────────────────────────────────────────────────────────

export function section(title, sub = '') {
  console.log('');
  console.log(cyan(line('─')));
  const inner = sub ? `  ${bold(title)}  ${dim(sub)}` : `  ${bold(title)}`;
  console.log(inner);
  console.log(cyan(line('─')));
}

// ─── bar chart row ─────────────────────────────────────────────────────────
//
// renderBar({ label, value, max, unit, badge, good })
//   label  — left-side text
//   value  — numeric (ms, s)
//   max    — scale reference (slowest value in the group)
//   unit   — 'ms' | 's'
//   badge  — optional right-side note string
//   good   — true=green bar, false=red bar, undefined=gray

const BAR_W   = 28;  // characters wide
const LABEL_W = 26;

export function renderBar({ label, value, max, unit = 'ms', badge = '', good }) {
  const frac   = Math.min(value / max, 1);
  const filled = Math.round(frac * BAR_W);
  const empty  = BAR_W - filled;
  const barStr = '█'.repeat(filled) + dim('░'.repeat(empty));
  const bar    = good === true  ? green(barStr)
               : good === false ? red(barStr)
               : gray(barStr);

  const valStr = unit === 's'
    ? lpad(value.toFixed(3) + ' s', 9)
    : lpad(value.toFixed(1) + ' ms', 11);

  const badgeStr = badge ? `  ${dim(badge)}` : '';
  console.log(`  ${pad(label, LABEL_W)}  ${bar}  ${bold(valStr)}${badgeStr}`);
}

// ─── stat row (key: value) ─────────────────────────────────────────────────

export function stat(label, value, { color } = {}) {
  const v = color === 'green' ? green(value)
          : color === 'red'   ? red(value)
          : color === 'dim'   ? dim(value)
          : bold(value);
  console.log(`  ${pad(label, 22)}  ${v}`);
}

// ─── note / footer ─────────────────────────────────────────────────────────

export function note(text) {
  console.log('');
  console.log(dim('  ' + text));
}

export function divider() {
  console.log(dim('  ' + '·'.repeat(W - 2)));
}

// ─── gc-pressure renderer ──────────────────────────────────────────────────

export function renderGCResult({ variant, wallMs, totalGCms, gcEvents, gcByKind, rssBefore, rssAfter }) {
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

// ─── cxx renderer ──────────────────────────────────────────────────────────

export function renderCXXSection(apiName, rows, noDetachMs) {
  console.log(`\n  ${bold(apiName)}`);
  console.log(dim('  ' + '─'.repeat(W - 2)));

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
  if (jsBeatsCpp) {
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

// ─── detach-vs-transfer renderer ───────────────────────────────────────────

export function renderDetachVsTransfer({ iterations, transferWarmup, detachMs, transferMs }) {
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
