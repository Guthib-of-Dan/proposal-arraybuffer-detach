# ArrayBuffer.prototype.detach

## Status

Author: Daniel Dyryl \<diril656@gmail.com\>

Stage: 0

## Have no time to read?
[Look at the overview.md](./overview.md)

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
already call `v8::ArrayBuffer::Detach` automatically after the request callback
returns — freeing the backing store immediately at the OS level. JavaScript has
no equivalent. The closest available option is:

```js
buffer.transfer(0)
```

This detaches the buffer but allocates an unnecessary zero-length `ArrayBuffer`
object in the process — adding GC pressure on top of the problem it solves.

---
[GC pressure benchmark](./demo/gc-pressure) is run in "Docker" with hard limited RAM for 300 mebabytes and no memory swap.  
It allocates new ArrayBuffer with 50MB size, initializes it (that memory is memory mapped by default),  
and compares the Garbage Collector's involvement when I clear that memory with transfer(0) in a loop and when I don't.
It illustrates that V8 engine lets buffers pile up and when memory usage reaches its top values (Docker makes it happen),  
GC slows the whole process.
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
Symmetric with `napi_detach_arraybuffer` or `v8::ArrayBuffer::Detach` already available to C++ embedders.

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
// nodejs specific "napi_detach_arraybuffer" api
import { setFlagsFromString } from 'node:v8'
setFlagsFromString('--allow-natives-syntax')
ArrayBuffer.prototype.detach = new Function('%ArrayBufferDetach(this)')
// or cross-platform option:
ArrayBuffer.prototype.detach = function() { this.transfer(0) }
```

### node:buffer limitation

`Buffer.allocUnsafe` and `Buffer.concat` may use internal preallocated slab, which means that such buffer can't be detached. Due to Buffer not exposing any "belongsToPool(): boolean" methods, using `Buffer.allocUnsafe` or `Buffer.concat` should be discouraged when used with ArrayBuffer.prototype.detach. 

Even though optimisation doesn't get applied to allocations exceeding `Buffer.poolSize`, using `Buffer.allocUnsafe` for such sizes does not differ in any way from `Buffer.allocUnsafeSlow`, which is more explicit and preferred.

## What changes

### [Click to see all examples](https://github.com/Guthib-of-Dan/proposal-json-parse-binary/tree/main/examples)

### node:http 

#### Before
This example doesn't use Buffer.concat, because it is less efficient overall, copies all buffers into
one while all chunks are alive  leading to 2X payload size simultaneously + individual chunks stay longer in memory,
because they would be kept until the end as an array for "concat"

```javascript
server.on('request', async (req, res) => {
  body = Buffer.allocUnsafe(Number(req.headers["content-length"]));
  var offset = 0;
  await new Promise((resolve) => {
    req.on("data", (chunk) => {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    })
    req.once("end", resolve)
  })

  let result;
  try {
    result = JSON.parse(body.toString());
  } catch (err) {
    res.writeHead(400).end(err.message);
    return;
  }
  // mark for GC
  body = undefined;

  // body sits in memory until GC decides to collect it
  handleResult(result);
});
```

#### After
```javascript
server.on('request', async (req, res) => {
  // memory-mapped buffer, doesn't consume whole memory when initialised.
  const body = Buffer.allocUnsafeSlow(Number(req.headers["content-length"]));
  var offset = 0;
  await new Promise((resolve) => {
    req.on("data", (chunk) => {
      // write to memory-mapped data (activate partially) and detach immediately
      body.set(chunk, offset);
      offset += chunk.byteLength;
      chunk.buffer.detach();
    })
    req.once("end", resolve)
  })

  // co-proposal, does not detach internally
  const parseResult = JSON.parseBinary(body);

  body.buffer.detach(); // body gets released after parse

  if (!parseResult.ok) {
    res.writeHead(400).end(parseResult.message);
    return;
  }
  handleResult(parseResult.value);
});
```

#### [Benchmark](./demo/node_http/server.mjs)
Results are provided by Grafana K6 load test

2 endpoints ("detach" and "nothing" with GC doing main work)

Duration - 10 seconds for each case.

Bodies
| tiny | medium | large |
|------|--------|-------|
|1 byte|  1 MB  | 10 MB |

> 1 byte payload is incredibly rare to be encountered, however here it demonstrates that it
> does not accumulate enough for GC to be triggered, so data is not cleared at all.
> In the meantime, we constantly "detach" buffers on the second endpoint, be it 1 byte or more.
> For 1 byte case we clear data each request manually, while on the previous endpoint GC stays silent, hence more work and slower execution.


```
http_reqs.......................:
      { scenario:nothing_tiny }.....: 120273 2004.491161/s
      { scenario:detach_tiny }......: 119363 1989.32494/s

      { scenario:nothing_medium }...: 18445  307.407643/s
      { scenario:detach_medium }....: 25476  424.587537/s

      { scenario:nothing_large }....: 2241   37.348904/s
      { scenario:detach_large }.....: 3163   52.715119/s

http_req_duration...............: 
      { scenario:nothing_tiny }.....: avg=56.94µs  min=46.26µs  med=55.38µs  max=10.8ms  p(90)=62.25µs  p(95)=65.79µs
      { scenario:detach_tiny }......: avg=57.46µs  min=46.72µs  med=56.4µs   max=1.75ms  p(90)=63.43µs  p(95)=66.82µs

      { scenario:nothing_medium }...: avg=443.35µs min=314.78µs med=358.38µs max=3.53ms  p(90)=637.46µs p(95)=1.08ms
      { scenario:detach_medium }....: avg=315.84µs min=262.79µs med=291.85µs max=1.15ms  p(90)=420.28µs p(95)=430.93µs

      { scenario:nothing_large }....: avg=3.99ms   min=2.63ms   med=3.21ms   max=9.61ms  p(90)=5.94ms   p(95)=6.64ms
      { scenario:detach_large }.....: avg=2.72ms   min=2.25ms   med=2.52ms   max=4.17ms  p(90)=3.68ms   p(95)=3.74ms

```

This test cannot be properly illustrated in Bun because it doesn't support "%ArrayBufferDetach" feature of V8, so results with "transfer(0)" are misleading.

### uWebSockets.js — manual detach within handler

uWS already calls `v8::ArrayBuffer::Detach` automatically after the callback
returns. `ArrayBuffer.prototype.detach()` enables calling it **from within**
the handler — before the callback returns — which is measurably faster due to
the buffer being hot in V8's inline cache at that point.

Results of [C++ addon benchmark](./demo/cxx) for 2M iterations on a 10 KB
static buffer:

> var internalDetach = new Function("buf", "%ArrayBufferDetach(buf)")
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

This means `ArrayBuffer.prototype.detach()` called from within uWebSockets.js HTTP/WebSocket handler
would be faster than C++ embedders' auto-detach behavior, in addition to giving
the developer explicit control over when memory is released.

The only problem that this idea stumbled upon is that nobody comes to JS  
to manage memory. That's why it is specifically targeted at 
networking libraries that can take responsibility, thoroughly test 
their technologies and improve performance without exposing
raw behaviour to developers.

But manual management can still be exposed and used.
At least I will be the one who uses it - benchmarks prove its benefit.

## Comparison

| | `.transfer(0)` | `.detach()` |
|---|---|---|
| Detaches backing store | ✔ | ✔ |
| Returns new ArrayBuffer | ✔ (zero-length) | — |
| Allocates intermediate object | ✔ | — |
| GC event triggered | IncrementalMarking | Scavenge |
| Symmetric with `napi_detach_arraybuffer` or `v8::ArrayBuffer::Detach` | — | ✔ |

## Relation to other proposals

- [proposal-json-parse-binary](https://github.com/Guthib-of-Dan/proposal-json-parse-binary) —
  eliminates the intermediate string cost; `.detach()` eliminates the residual
  buffer cost. The two proposals compose directly in the combined example above.
- [TC39 Explicit Resource Management](https://github.com/tc39/proposal-explicit-resource-management)
  (Stage 4) — a future extension could implement `Symbol.dispose` on
  `ArrayBuffer` to enable `using buf = getBuffer()`, automatically detaching
  when the block exits. Kept out of this initial proposal.

## Q&A

**what about edge cases like unsafe usage after detaching?**
They are the same as of .transfer()
https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer/transfer

**Why not overload `transfer()`?**
`.transfer(0)` already exists and already allocates a zero-length `ArrayBuffer`.
Changing its behavior would be a breaking change. `.detach()` is a separate
method with a distinct, simpler contract: detach and return nothing.

**Why not just rely on GC?**
GC collects memory eventually — but "eventually" means unpredictably. Under
concurrent load, multiple request buffers accumulate faster than GC runs,
causing RSS growth and stop-the-world pauses at peak traffic. `.detach()` makes
release deterministic and immediate, independent of GC scheduling.

**Why not go to C++ / Rust and handle memory there?**
This is a frequent question. Yes. My answer is the same: "we can implement it, we can use it, it has benefits. Why not?"

**Is this the same as `napi_detach_arraybuffer`?**
Yes — semantically identical. This proposal exposes the same operation to
JavaScript that C++ embedders have had since Node.js 13.
