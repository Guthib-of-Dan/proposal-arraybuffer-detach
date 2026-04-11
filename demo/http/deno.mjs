// %ArrayBufferDetach is not available for Deno, that's why 
// performance on "/detach" route as "/nothing"
//
ArrayBuffer.prototype.detach = function(){this.transfer(0)}
Deno.serve({ port: 8080 }, async (req) => {
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
})
