FROM node:25.0.0-alpine
WORKDIR /test
COPY demo/gc-pressure/index.mjs demo/helpers.mjs /test/
ENV variant=all
CMD ["sh", "-c", "node --expose-gc index.mjs ${variant}"]
