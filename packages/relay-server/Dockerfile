FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY packages/relay-server/package.json packages/relay-server/

RUN bun install --production

COPY packages/shared/src packages/shared/src
COPY packages/relay-server/src packages/relay-server/src

EXPOSE 3000
CMD ["bun", "run", "packages/relay-server/src/index.ts"]
