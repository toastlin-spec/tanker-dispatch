# 油罐車派車管理系統

這是給加油站調度員用的派車系統：排定 4 位司機從台中廠、麥寮廠出車，到彰濱廠或 R89 灌油，再送到 10 個加油站。

- **業務規則一律以 `docs/spec.md` 為準。** 規格沒寫到的業務問題，先問使用者，不要自己猜。
- 初始資料在 `data/`：
  - `locations.json`：據點與營業時間。
  - `legs.json`：路段時間。
  - `settings.json`：作業時間、倍數、單數上限、規則。
  - `fleet.json`：司機與車輛（佔位）。

## 慣例

- 介面文字、錯誤訊息、文件都用繁體中文；程式識別名稱用英文。
- 時區一律 Asia/Taipei。大夜班 00:00 出車，班表的日期就是出車那天。
- 路段時間、作業時間、營業時間、單數上限和規則門檻都存在資料庫，並且可在設定頁修改。程式裡不可寫死這些數字；測試用的固定資料除外。
- 缺少路段時間時，不可自行推估；要明確標示「缺少路段時間」。
- 時間軸計算放在 `packages/core`：純函式，沒有 I/O，前端和後端共用。規則檢查也放在這裡。

## 架構

- `packages/core`：TypeScript，用 Vitest 測試。
- `apps/api`：NestJS + Prisma + PostgreSQL。
- `apps/web`：React + Vite + Ant Design（zh_TW）。
- 部署目標：GCP Cloud Run + Cloud SQL（asia-east1）。

開發時如果環境沒有 PostgreSQL，可以用 `embedded-postgres` 或 Docker；不要因此改用其他資料庫。

## 測試

`packages/core` 的單元測試必須涵蓋 `docs/spec.md` 第 6.4 節的範例 A、B、C，以及第 7 節每一條規則的通過與違規情況。
