FROM oven/bun:1.2 AS build

WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
COPY src ./src
COPY commands ./commands
COPY README.md LICENSE ./

RUN bun install --frozen-lockfile
RUN bun run build

FROM oven/bun:1.2

WORKDIR /app

COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

ENV TS_HUB_PORT=3476
ENV TS_HUB_DB_PATH=/data/hub.sqlite

EXPOSE 3476

CMD ["bun", "dist/hub/main.js"]
