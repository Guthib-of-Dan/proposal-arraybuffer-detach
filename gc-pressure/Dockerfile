FROM node:25.0.0-alpine
WORKDIR /test
COPY gc-pressure/index.mjs bench-render.mjs /test/
ENV variant=all
CMD ["sh", "-c", "node --expose-gc index.mjs ${variant}"]
