# ArrayBuffer.prototype.detach

## Status

Author: Daniel Dyryl \<diril656@gmail.com\>

Stage: 0

## Problem

Every JSON parsing operation in a JavaScript HTTP server follows this pipeline:

```
network bytes (ArrayBuffer / Uint8Array)
  → string = TextDecoder.decode()   — allocates a new JS string
  → JSON.parse(string)              — parses, throws SyntaxError on failure
  → object
```

The initial buffer sits in memory through this entire process — and beyond.
For a detailed breakdown of the intermediate string cost, SyntaxError overhead,
and the decode-before-validate waste, see
[proposal-json-parse-binary](https://github.com/Guthib-of-Dan/proposal-json-parse-binary).

This proposal addresses the remaining problem: **the original buffer is never
explicitly released.**

### Initial buffer stays in memory

We receive 1× payload as binary, convert to string (2–3×), parse to JSON (3–4×+),
but never clear the initial buffer.

If the buffer arrives as a callback parameter, it cannot even be marked for
Garbage Collection — a live reference outside the callback persists.
Even without any explicit reference, GC may run arbitrarily late.

Under load, memory accumulates to its top levels and V8 will "stop the world"
to clear all unreferenced memory, causing latency spikes at the worst possible
moment — peak traffic.

### No JS API for immediate release

C++ embedders like [uWebSockets.js](https://github.com/uNetworking/uWebSockets.js)
already call `napi_detach_arraybuffer` automatically after the request callback
returns — freeing the backing store immediately at the OS level. JavaScript has
no equivalent. The closest available option is:

```js
buffer.transfer(0)
```

This detaches the buffer but allocates an unnecessary zero-length `ArrayBuffer`
object in the process — adding GC pressure on top of the problem it solves.

---

Results of [GC pressure benchmark](./demo/gc-pressure) for 2000 iterations of
50 MB buffers under a Docker 300 MB memory limit:

```
✔ detach()      RSS +0.5 MB   GC time    0.3 ms   GC events    1  (Scavenge)
~ transfer(0)   RSS +0.5 MB   GC time    3.0 ms   GC events    1  (IncrementalMarking)
✘ no release    RSS +101 MB   GC time 1393.9 ms   GC events 1335  (WeakCallbacks + IncrementalMarking)
```

`detach()` triggers only a `Scavenge` — a fast young-generation sweep.
`transfer(0)` triggers `IncrementalMarking` — V8 spreading marking work across
frames to avoid a freeze, paid for the intermediate `ArrayBuffer(0)` it creates.
No release causes 1335 GC events consuming **15.7% of total wall time**.

GC event types observed:

| Event | Description |
|---|---|
| `Scavenge` | Clean up short-lived objects quickly |
| `MarkSweepCompact` | Deep cleaning of long-lived memory |
| `IncrementalMarking` | Spread marking work to avoid freezes |
| `WeakCallbacks` | Finalize and clean up weakly held objects |

### Global TextDecoder or Buffer.from() in Node.js

This problem is shared with `proposal-json-parse-binary` — see
[its README](https://github.com/Guthib-of-Dan/proposal-json-parse-binary#global-textdecoder-or-bufferfrom-in-nodejs)
for the full description.

### SyntaxError

This problem is shared with `proposal-json-parse-binary` — see
[its README](https://github.com/Guthib-of-Dan/proposal-json-parse-binary#syntaxerror)
for the full description.

## Idea

Introduce `ArrayBuffer.prototype.detach()` — an explicit immediate release
that frees the backing store at the OS level without allocating an intermediate
zero-length `ArrayBuffer`.

Semantically equivalent to `.transfer(0)` but without the wasteful allocation.
Symmetric with `napi_detach_arraybuffer` already available to C++ embedders.

### TypeScript declaration

```typescript
interface ArrayBuffer {
    /**
     * Detaches this ArrayBuffer, releasing the backing store immediately.
     * The buffer becomes zero-length and unusable after this call.
     * Equivalent to .transfer(0) without allocating an intermediate ArrayBuffer.
     */
    detach(): void;
}
```

### Polyfill

```js
import { setFlagsFromString } from 'node:v8'
setFlagsFromString('--allow-natives-syntax')
ArrayBuffer.prototype.detach = new Function('%ArrayBufferDetach(this)')
// or:
ArrayBuffer.prototype.detach = function() { this.transfer(0) }
```

## What changes

### node:http before

```javascript
server.on('request', async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  let result;
  try {
    result = JSON.parse(body.toString());
  } catch (err) {
    res.writeHead(400).end(err.message);
    return;
  }
  // body sits in memory until GC decides to collect it
  handleResult(result);
});
```

### node:http after

```javascript
server.on('request', async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  const parseResult = JSON.parseBinary(body);
  body.buffer.detach(); // released immediately — backing store freed at OS level

  if (!parseResult.ok) {
    res.writeHead(400).end(parseResult.message);
    return;
  }
  handleResult(parseResult.value);
});
```

### uWebSockets.js — manual detach within handler

uWS already calls `napi_detach_arraybuffer` automatically after the callback
returns. `ArrayBuffer.prototype.detach()` enables calling it **from within**
the handler — before the callback returns — which is measurably faster due to
the buffer being hot in V8's inline cache at that point.

Results of [C++ addon benchmark](./demo/cxx) for 2M iterations on a 10 KB
static buffer:

```
V8 API
  C++ detach via JS call      7.768 s   ⚑ 6.7% faster than C++ auto-detach
  C++ detach after callback   8.324 s   post-callback, handle is cold
  internalDetach()            7.664 s
  no detach                  24.769 s   3.1× slower than any detach path

NAPI
  internalDetach()           11.033 s
  C++ detach via JS call     11.113 s
  C++ detach after callback  11.671 s
  no detach                  47.804 s   4.2× slower than any detach path
```

⚑ JS-call detach outpaces C++ auto-detach because the buffer handle is still
hot in V8's inline cache and register state when called from within the
callback frame. After the callback returns, V8 tears down that frame and the
handle becomes cold — paying an extra lookup on every request.

This means `ArrayBuffer.prototype.detach()` called from within a uWS handler
would be faster than uWS's current auto-detach behavior, in addition to giving
the developer explicit control over when memory is released.

## Comparison

| | `.transfer(0)` | `.detach()` |
|---|---|---|
| Detaches backing store | ✔ | ✔ |
| Returns new ArrayBuffer | ✔ (zero-length) | — |
| Allocates intermediate object | ✔ | — |
| GC event triggered | IncrementalMarking | Scavenge |
| Symmetric with `napi_detach_arraybuffer` | — | ✔ |

## Relation to other proposals

- [proposal-json-parse-binary](https://github.com/Guthib-of-Dan/proposal-json-parse-binary) —
  eliminates the intermediate string cost; `.detach()` eliminates the residual
  buffer cost. The two proposals compose directly in the combined example above.
- [TC39 Explicit Resource Management](https://github.com/tc39/proposal-explicit-resource-management)
  (Stage 4) — a future extension could implement `Symbol.dispose` on
  `ArrayBuffer` to enable `using buf = getBuffer()`, automatically detaching
  when the block exits. Kept out of this initial proposal.

## Q&A

**Why not overload `transfer()`?**
`.transfer(0)` already exists and already allocates a zero-length `ArrayBuffer`.
Changing its behavior would be a breaking change. `.detach()` is a separate
method with a distinct, simpler contract: detach and return nothing.

**Why not just rely on GC?**
GC collects memory eventually — but "eventually" means unpredictably. Under
concurrent load, multiple request buffers accumulate faster than GC runs,
causing RSS growth and stop-the-world pauses at peak traffic. `.detach()` makes
release deterministic and immediate, independent of GC scheduling.

**Is this the same as `napi_detach_arraybuffer`?**
Yes — semantically identical. This proposal exposes the same operation to
JavaScript that C++ embedders have had since Node.js 13.
