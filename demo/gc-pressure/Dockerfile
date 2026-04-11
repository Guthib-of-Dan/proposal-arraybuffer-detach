FROM node:24-slim
WORKDIR /test
COPY demo/gc-pressure/index.mjs demo/helpers.mjs /test/
ENV variant=all
CMD ["sh", "-c", "node --expose-gc index.mjs ${variant}"]
