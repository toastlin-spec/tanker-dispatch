#!/bin/sh
# 容器啟動：套用資料庫 migration → 資料庫是空的就匯入 data/*.json → 啟動 API。
# 多個執行個體同時啟動時，Prisma 會用資料庫鎖避免重複套用 migration。
set -e
cd "$(dirname "$0")"
BIN="$(cd ../.. && pwd)/node_modules/.bin"
"$BIN/prisma" migrate deploy
"$BIN/tsx" prisma/seed.ts
exec node dist/main.js
