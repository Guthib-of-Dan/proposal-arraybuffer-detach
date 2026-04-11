# ArrayBuffer.prototype.detach
This is method that "detaches" memory from an ArrayBuffer, or "clears" it.  
It has several purposes:
  - Garbage Collector is too slow, so this is a workaround. [GC pressure benchmark](./demo/gc-pressure/index.mjs) suggests that using ".detach" reduces execution time for memory-heavy applications by 2 seconds from 12. Use .detach() - 10 seconds, use nothing - 12 seconds. 
  - Heavy concurrency. 
    ```
    Payload comes -> parse payload -> async Database query (buffer is still alive)
    -> comes payload 2 -> parse payload 2 (buffer 1 (likely) still alive) -> async Database query (buffer 1 (likely) and buffer 2 are alive)
    ```
    
    Countless optimisations are possible, when memory is under control.

  - Guaranteed stability. Avoiding unpredictable GC makes application more resistant to memory spikes.

## Is this difficult to implement?
No. Implementing this is almost like doing "copy-paste" from "ArrayBuffer.prototype.transfer" method and  
strip everything, apart from memory "clearing".  

## How to handle edge-cases?
After you call this function, its "ArrayBuffer" becomes unusable, so when using this  
it is recommended to encapsulate logic OR take responsibility for actions (make sure  
that nobody touches it afterwards)  

## Example
```javascript
// what developer interacts with 
server.post("/large-data", async (req, res)=>{
  const ContentLength = Number(req.headers["content-length"]);
  const body = await getBody();
  const parseResult = parseAbstraction(body)

  handleData(parseResult);
  res.end("ok")
})

// I don't promote this, but for frameworks - best option. 
function parseAbstraction(body) {
  const parseResult = parseSomehow(body)
  body.buffer.detach(); // release body
  return parseResult;
}

async function getBody(req, ContentLength) {
  // not allocUnsafe to avoid 8KB slab un undetachable buffers
  var body = Buffer.allocUnsafeSlow(ContentLength)
  var writeOffset = 0;

  // not Buffer.concat to avoid 8KB slab
  for await (const chunk of req) { 
    body.set(chunk, writeOffset);
    writeOffset += chunk.length;
    // clear each chunk
    chunk.buffer.detach();
  }

  return body;
}





```
