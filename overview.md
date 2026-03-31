# Briefly: what does ArrayBuffer.prototype.detach and when to use it
ArrayBuffer.prototype.detach - method that "detaches" memory from an ArrayBuffer, or "clears" it. 
That's a workaround because GC is too slow. 
[GC pressure benchmark](./gc-pressure/index.mjs) suggests that using ".detach" reduces execution time 
for memory-heavy applications by 2 seconds from 12. 
Use .detach - 10 seconds, use nothing - 12 seconds.
Those 2 seconds can cost you many http clients everyone so desperately wants to please.
## Is this difficult to implement?
No. Implementing this is almost like doing "copy-paste" from "ArrayBuffer.prototype.transfer" method and 
strip everything, apart from memory "clearing".
## How to handle edge-cases?
After you call this function, its "ArrayBuffer" becomes unusable, so when you use this 
you are adviced to encapsulate logic OR take responsibility for your actions (make sure
that nobody touches it afterwards)
## Example (if it is scary - make an abstraction that no one sees it)
```javascript
server.post("/large-data", (req, res)=>{
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
    
  // clear all chunks manually
  for (const chunk of chunks) chunk.buffer.detach();

  const parseResult = parseSomehow(body)
  body.buffer.detach(); // release body
  
  // handle parseResult
})
```
