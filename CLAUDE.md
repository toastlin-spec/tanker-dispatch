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

## 部署（GCP Cloud Run + Cloud SQL，asia-east1）

- 步驟一律依 `docs/deploy.md`；登入用的 OAuth 用戶端依 `docs/auth.md`。使用者通常在 Cloud Shell 執行 Claude Code，gcloud 已登入使用者的帳號。
- 使用者不是工程師：每一步先用一兩句白話說明要做什麼、會不會產生費用，再執行。
- 下列動作執行前一定要先問使用者並等確認：建立 Cloud SQL 執行個體（會持續計費）、刪除任何 GCP 資源、修改 IAM 權限、刪除或覆寫 Secret Manager 的密鑰、清空資料庫。
- 只有使用者能做的事，請引導他操作，不要假裝完成：在 GCP 主控台建立 OAuth 用戶端、貼上用戶端密碼。
- 密碼與密鑰只放在 Secret Manager，不要印在畫面上，也不要寫進 repo；`deploy.env` 不能 commit。
- 部署或更新：`bash scripts/deploy-cloudrun.sh`。有錯誤時先用 `gcloud run services logs read` 看記錄，再對照 `docs/deploy.md` 的「疑難排解」。
