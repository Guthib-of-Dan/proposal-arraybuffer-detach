import {createServer} from "node:http"
import {setFlagsFromString} from "node:v8"

// polyfill
setFlagsFromString("--allow-natives-syntax")
ArrayBuffer.prototype.detach = new Function("%ArrayBufferDetach(this)")
var server = createServer();

server.on("request", async (req, res) => {
  switch (req.url) {

    case "/detach": {
      // memory-mapped virtual buffer, gets activated incrementally
      // Buffer.allocUnsafe should be avoided for the reasons above
      let data = Buffer.allocUnsafeSlow(Number(req.headers["content-length"]));
      let offset = 0;
      await new Promise((resolve) => {
        req.on("data", (chunk) => {
          // write to memory-mapped data and detach immediately, so "data" + "chunks" don't consume more than "1X + 1 chunk" memory
          data.set(chunk, offset);
          offset += chunk.byteLength;
          chunk.buffer.detach();
        })
        req.once("end", resolve)
      })
      // use final buffer and detach it. Here - just detach
      data.buffer.detach();
      break;
    }

    case "/nothing": {
      let data = Buffer.allocUnsafe(Number(req.headers["content-length"]));
      let offset = 0;
      await new Promise((resolve) => {
        req.on("data", (chunk) => {
          data.set(chunk, offset);
          offset += chunk.byteLength;
        })
        req.once("end", resolve)
      })
      break;
    }
  }
  res.end("hello")
})
server.listen(8080)
