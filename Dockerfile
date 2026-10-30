# 油罐車派車系統：API 與前端打包成同一個容器（Cloud Run）。

FROM node:22-bookworm-slim AS base
# Prisma 需要 openssl。
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- 建置：核心模組、API、前端 ----
FROM base AS build
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/api/prisma apps/api/prisma
COPY apps/web/package.json apps/web/
RUN npm ci
COPY packages packages
COPY apps apps
RUN npm run build

# ---- 執行：只裝 API 需要的套件 ----
FROM base AS runtime
ENV NODE_ENV=production \
    TZ=Asia/Taipei \
    PORT=8080
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/api/prisma apps/api/prisma
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev -w @tanker/api -w @tanker/core && npm cache clean --force
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/apps/api/dist apps/api/dist
# seed.ts 會用到 src 裡的設定預設值。
COPY --from=build /app/apps/api/src apps/api/src
COPY --from=build /app/apps/api/tsconfig.json apps/api/tsconfig.json
COPY --from=build /app/apps/web/dist apps/web/dist
COPY tsconfig.base.json ./
COPY data data
COPY apps/api/docker-start.sh apps/api/docker-start.sh
USER node
EXPOSE 8080
CMD ["sh", "apps/api/docker-start.sh"]
