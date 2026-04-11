# ArrayBuffer.prototype.detach

## Status

Author: Daniel Dyryl \<diril656@gmail.com\>

Stage: 0

## Want to summarise information below?
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
> this example doesn't show error handling
```javascript

//____some hidden framework's payload handler___//
async function frameworkGetBody(req, res) {
    // .... accumulate body ....
    req.body = bodyBuffer; //

    await hostCallback(req, res);

    // ... does not touch bodyBuffer anymore, quits
}

//____________ our module _____________//
var decoder = new TextDecoder();

// like an HTTP handler we register in frameworks
async function hostCallback(req, res) {
    var data = JSON.parse(decoder.decode(req.body));
    // while performing this asynchronous work req.body stays alive
    await Database.writeRecord(data);
}

// practical example
framework.post("/link", hostCallback);
```

Under load or with asynchronous handling, memory accumulates to its top levels and V8
will "stop the world" to clear all unreferenced memory, causing latency spikes 
at the worst possible moment — peak traffic.

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
    /** existing methods / prooperties */

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

### NodeJS node:http 

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
  res.end("ok")
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
  res.end("ok")
});
```

#### [Benchmark](./demo/http/node_http.mjs)
Results are provided by Grafana K6 load test in Docker with 300MB memory cap

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

Polyfill - "%ArrayBufferDetach" of V8
```
http_req_duration...............: 
  { scenario:nothing_tiny }.....: avg=213.93µs min=152.41µs med=209.72µs max=5.23ms  p(90)=239.57µs p(95)=250.69µs
  { scenario:detach_tiny }......: avg=212.34µs min=157.68µs med=210.85µs max=2.45ms  p(90)=235.16µs p(95)=243.06µs

  { scenario:nothing_medium }...: avg=880.99µs min=592.21µs med=719.75µs max=5.47ms  p(90)=1.1ms    p(95)=1.93ms  
  { scenario:detach_medium }....: avg=742.03µs min=542.42µs med=662.05µs max=4.73ms  p(90)=928.36µs p(95)=1.1ms   

  { scenario:nothing_large }....: avg=6.88ms   min=4.54ms   med=6.06ms   max=14.02ms p(90)=10.47ms  p(95)=11.26ms 
  { scenario:detach_large }.....: avg=4.75ms   min=3.73ms   med=4.62ms   max=9.12ms  p(90)=5.54ms   p(95)=5.88ms  

http_reqs.......................:
  { scenario:nothing_tiny }.....: 37632  627.157251/s
  { scenario:detach_tiny }......: 38220  636.956583/s

  { scenario:nothing_medium }...: 9983   166.371993/s
  { scenario:detach_medium }....: 11775  196.236624/s

  { scenario:nothing_large }....: 1341   22.348477/s
  { scenario:detach_large }.....: 1895   31.581181/s

```

### Bun

#### Before

```javascript
// keep decoder globally, headache with managing variables
var decoder = new TextDecoder();
Bun.serve({
  port: 8080,
  async fetch(req) {
    var body = await req.arrayBuffer();
    
    let result;
    try {
      result = JSON.parse(decoder.decode(body));
    } catch (err) {
      return new Response(err.message, { status: 400 });
    }
    // mark for GC
    body = undefined;

    // body sits in memory until GC decides to collect it
    handleResult(result);
    return new Response("ok")
  }
});
```

#### After
```javascript
Bun.serve({
  port: 8080,
  async fetch(req) {
    const body = await req.arrayBuffer();

    //co-proposal, parse json without TextDecoder
    const parseResult = JSON.parseBinary(body);
    
    // clear body immediately
    body.detach();
    
    if(!parseResult.ok) {
        return new Response(parseResult.message, { status: 400 });
    }
    
    // do something with that body
    handleResult(parseResult.value);

    return new Response("ok")
  }
});
```

#### [Benchmark](./demo/http/bun.mjs)
Benchmark configuration is the same as of node:http above

In Bun ".transfer(0)" was used as polyfill, that is why the difference is very slight. Even so we get predictable memory usage and more room for concurrent requests
```
http_req_duration...............: 
  { scenario:nothing_tiny }.....: avg=184.89µs min=131.77µs med=180.6µs  max=1.51ms  p(90)=201.05µs p(95)=209.24µs
  { scenario:detach_tiny }......: avg=184.98µs min=123.71µs med=180.74µs max=1.65ms  p(90)=200.84µs p(95)=208.96µs

  { scenario:nothing_medium }...: avg=712.5µs  min=541.86µs med=647.38µs max=3.71ms  p(90)=896.61µs p(95)=1.1ms   
  { scenario:detach_medium }....: avg=673.02µs min=502.17µs med=628.2µs  max=3.18ms  p(90)=792.96µs p(95)=900.97µs

  { scenario:nothing_large }....: avg=5.33ms   min=3.97ms   med=5.16ms   max=16.43ms p(90)=6.14ms   p(95)=6.43ms  
  { scenario:detach_large }.....: avg=5.38ms   min=3.91ms   med=5.11ms   max=14.72ms p(90)=6.3ms    p(95)=6.97ms  

http_reqs.......................: 
  { scenario:nothing_tiny }.....: 43052  717.483599/s
  { scenario:detach_tiny }......: 43184  719.683446/s

  { scenario:nothing_medium }...: 12058  200.952737/s
  { scenario:detach_medium }....: 12859  214.301812/s

  { scenario:nothing_large }....: 1695   28.248042/s
  { scenario:detach_large }.....: 1693   28.214711/s


```

This test cannot be properly illustrated in Bun because it doesn't support "%ArrayBufferDetach" feature of V8, so results with "transfer(0)" are not as performant as intended

### Deno 


```javascript
// keep decoder globally, headache with managing variables
var decoder = new TextDecoder();
Deno.serve({ port: 8080 }, async (req) => {
    var body = await req.arrayBuffer();
    
    let result;
    try {
      result = JSON.parse(decoder.decode(body));
    } catch (err) {
      return new Response(err.message, { status: 400 });
    }
    // mark for GC
    body = undefined;

    // body sits in memory until GC decides to collect it
    handleResult(result);
    return new Response("ok")
  }
});
```

#### After
```javascript
Deno.serve({ port: 8080 }, async (req) => {
    const body = await req.arrayBuffer();

    //co-proposal, parse json without TextDecoder
    const parseResult = JSON.parseBinary(body);
    
    // clear body immediately
    body.detach();
    
    if(!parseResult.ok) {
        return new Response(parseResult.message, { status: 400 });
    }
    
    // do something with that body
    handleResult(parseResult.value);

    return new Response("ok")
  }
});
```


#### [Benchmark](./demo/http/deno.mjs)
Benchmark configuration is the same as of node:http and Bun above

Polyfill - ".transfer(0)"

```
http_req_duration...............:
  { scenario:nothing_tiny }.....: avg=223.54µs min=163.37µs med=218.77µs max=7.02ms  p(90)=244.53µs p(95)=254.76µs
  { scenario:detach_tiny }......: avg=215.01µs min=163.14µs med=213.66µs max=2.5ms   p(90)=235.96µs p(95)=242.58µs

  { scenario:nothing_medium }...: avg=817.97µs min=518.48µs med=648.87µs max=7.51ms  p(90)=1.07ms   p(95)=1.62ms  
  { scenario:detach_medium }....: avg=679.84µs min=504.29µs med=632.11µs max=3.09ms  p(90)=822.79µs p(95)=887.42µs

  { scenario:nothing_large }....: avg=5.97ms   min=3.82ms   med=5.36ms   max=16.02ms p(90)=8.65ms   p(95)=9.67ms  
  { scenario:detach_large }.....: avg=4.73ms   min=3.66ms   med=4.63ms   max=9.28ms  p(90)=5.52ms   p(95)=5.77ms  

http_reqs.......................: 
  { scenario:nothing_tiny }.....: 36401  606.633941/s
  { scenario:detach_tiny }......: 37725  628.698811/s

  { scenario:nothing_medium }...: 10655  177.568876/s
  { scenario:detach_medium }....: 12755  212.566026/s

  { scenario:nothing_large }....: 1512   25.197948/s
  { scenario:detach_large }.....: 1879   31.314117/s


```

## uWebSockets.js — manual detach within handler

uWS already calls `v8::ArrayBuffer::Detach` automatically after the callback
returns. `ArrayBuffer.prototype.detach()` enables calling it **from within**
the handler — before the callback returns — which is measurably faster due to
the buffer being hot in V8's inline cache at that point.

Results of [C++ addon benchmark](./demo/cxx) for 2M iterations on a 10 KB
static buffer:

> var internalDetach = new Function("buf", "%ArrayBufferDetach(buf)")
```
V8 API
  ──────────────────────────────────────────────────────────────────
  warmup                      ███████████░░░░░░░░░░░░░░░░░    9.873 s
  C++ detach via JS call      ██████████░░░░░░░░░░░░░░░░░░    8.510 s  7.9% faster than C++ auto-detach  ⚑
  C++ detach after callback   ███████████░░░░░░░░░░░░░░░░░    9.240 s  C++ post-callback detach
  internalDetach()            ██████████░░░░░░░░░░░░░░░░░░    8.449 s
  C++ detach after cb (2nd)   ███████████░░░░░░░░░░░░░░░░░    9.423 s  C++ post-callback detach
  internalDetach() (2nd)      ██████████░░░░░░░░░░░░░░░░░░    8.325 s
  no detach                   ████████████████████████████   24.504 s  2.8× slower than avg detach
  ··································································

V8 + node::MakeCallback
  ──────────────────────────────────────────────────────────────────
  warmup                      ██████████████░░░░░░░░░░░░░░   12.515 s
  C++ detach via JS call      █████████████░░░░░░░░░░░░░░░   11.552 s  8.5% faster than C++ auto-detach  ⚑
  C++ detach after callback   ██████████████░░░░░░░░░░░░░░   12.629 s  C++ post-callback detach
  internalDetach()            █████████████░░░░░░░░░░░░░░░   11.787 s
  C++ detach after cb (2nd)   ██████████████░░░░░░░░░░░░░░   12.535 s  C++ post-callback detach
  internalDetach() (2nd)      █████████████░░░░░░░░░░░░░░░   11.658 s
  no detach                   ████████████████████████████   24.504 s  2.0× slower than avg detach
  ··································································


NAPI
  ──────────────────────────────────────────────────────────────────
  internalDetach              ███████░░░░░░░░░░░░░░░░░░░░░   11.853 s
  C++ detach via JS call      ███████░░░░░░░░░░░░░░░░░░░░░   12.342 s
  C++ detach after cb         ███████░░░░░░░░░░░░░░░░░░░░░   12.980 s
  no detach                   ████████████████████████████   50.867 s  4.1× slower than avg detach
````

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
At least I will be one of those who use it - benchmarks prove its benefit.

## Comparison

| | `.transfer(0)` | `.detach()` |
|---|---|---|
| Detaches backing store | ✔ | ✔ |
| Returns new ArrayBuffer | ✔ (zero-length) | — |
| Allocates intermediate object | ✔ | — |
| GC event triggered | IncrementalMarking | Scavenge |
| Symmetric with `napi_detach_arraybuffer` or `v8::ArrayBuffer::Detach` | — | ✔ |

## Relation to other proposals / discussions / implementations

- [proposal-json-parse-binary](https://github.com/Guthib-of-Dan/proposal-json-parse-binary) —
  eliminates the intermediate string cost; `.detach()` eliminates the residual
  buffer cost. The two proposals compose directly in the combined example above.
- [TC39 Explicit Resource Management](https://github.com/tc39/proposal-explicit-resource-management)
  (Stage 4) — a future extension could implement `Symbol.dispose` on
  `ArrayBuffer` to enable `using buf = getBuffer()`, automatically detaching
  when the block exits. Kept out of this initial proposal.
- [TC39 Immutable ArrayBuffers](https://tc39.es/proposal-immutable-arraybuffer/#sec-detacharraybuffer)
  (Stage 2.7) - in this proposal intrinsic handler for detaching buffers is already described,
  just not exposed. `DetachArrayBuffer ( arrayBuffer [ , key ] )` is an internal functionality,
  while `ArrayBuffer.prototype.detach` is its exposed caller.
- [ArrayBuffer.prototype.transfer and friends](https://github.com/tc39/proposal-arraybuffer-transfer)
  (Stage 4) - cross-platform polyfill for this proposal, but its purpose is different, so
  this proposal exists for the sake of removing additional, unnecessary for this use-case, work.
  Some of the following links are taken from this proposal, because are still relevant
- [Comment inside NodeJS's codebase](https://github.com/nodejs/node/blob/main/lib/querystring.js#L472)
  tells that try-catch blocks are not optimised up to V8 5.4 and still are not inlined, hurting performance.
- [V8 `v8::ArrayBuffer::Detach`](https://v8docs.nodesource.com/node-18.2/d5/d6e/classv8_1_1_array_buffer.html#abb7a2b60240651d16e17d02eb6f636cf)
- [JavaScriptCore ArrayBuffer::detach](https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/runtime/ArrayBuffer.cpp#L468)

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
