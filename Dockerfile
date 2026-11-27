FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/renderer/package.json packages/renderer/package.json
RUN npm ci
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.json tsconfig.base.json ./
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production HOST=0.0.0.0 DECKAI_SERVE_WEB=true PDF_BROWSER_PATH=/usr/bin/chromium
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/src ./apps/api/src
COPY --from=build /app/packages ./packages
COPY --from=build /app/dist-app ./dist-app
COPY db/migrations ./db/migrations
COPY package.json tsconfig.json tsconfig.base.json ./
COPY apps/api/tsconfig.json ./apps/api/tsconfig.json
USER node
CMD ["node", "--import=tsx", "apps/api/src/server.ts"]
