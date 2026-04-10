// bench-render.mjs — shared CLI renderer for ArrayBuffer.detach() benchmarks
//
// All formatting lives here. Benchmark files import { render*, section, note }
// and never call console.log themselves for result output.

const W = 68; // total box width

// ─── primitives ────────────────────────────────────────────────────────────

export function pad(str, len, char = ' ') {
  return String(str).padEnd(len, char).slice(0, len);
}
export function lpad(str, len) {
  return String(str).padStart(len);
}
export function line(char = '─') {
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

export function green(s)  { return c.green  + s + c.reset; }
export function red(s)    { return c.red    + s + c.reset; }
export function yellow(s) { return c.yellow + s + c.reset; }
export function cyan(s)   { return c.cyan   + s + c.reset; }
export function dim(s)    { return c.dim    + s + c.reset; }
export function bold(s)   { return c.bold   + s + c.reset; }
export function gray(s)   { return c.gray   + s + c.reset; }

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
    : lpad(value.toFixed(1) + ' ' + unit, 11);

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
