// %ArrayBufferDetach is not available for Bun, that's why 
// .transfer(0) with its overhead still has almost the same 
// performance on "/detach" route as "/nothing"
import Bun from "bun"
ArrayBuffer.prototype.detach = function(){this.transfer(0)}
Bun.serve({
  port: 8080,
  async fetch(req) {
    switch (new URL(req.url).pathname) {
      case "/detach": {
        const buf = await req.arrayBuffer();
        buf.detach();
        break;
      }

      case "/nothing": {
        await req.arrayBuffer();
        break;
      }
    }
    return new Response("hello")
  },
});

