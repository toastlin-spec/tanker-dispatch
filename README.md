# 油罐車派車管理系統

加油站油罐車的調度排班系統，給調度員使用：

- 安排司機從台中廠、麥寮廠出車。
- 到彰濱廠或 R89 灌油。
- 送到中部與南部的加油站。

系統會自動算出每趟的時間軸，並檢查排班規則（做六休一、兩天之間休息 11 小時、油站營業時間等）。

- 規格書：[docs/spec.md](docs/spec.md)
- 初始資料：[data/](data/)

## 啟動

需要 Node.js 20.19 以上（建議 22）。

```bash
npm install
```

```bash
npm run dev
```

- 前端：<http://localhost:5173>
- API：<http://localhost:3000/api>

`npm run dev` 會依序：

1. 沒有設定 `DATABASE_URL` 時，自動啟動 embedded-postgres（資料放在 `.pg-data/`，連接埠 54329）。
2. 編譯核心模組、套用資料庫 migration。
3. 資料庫是空的就從 `data/*.json` 匯入初始資料。
4. 同時啟動 API 與前端，按 Ctrl+C 一起關閉。

要用自己的 PostgreSQL（例如 Docker 或 Cloud SQL），複製 `.env.example` 成 `.env` 並設定 `DATABASE_URL`。

### 登入

只有「登入名單」上的 Google 帳號可以使用系統，名單在「設定 → 使用者（登入名單）」管理。

- 本機沒有設定 Google 登入時，`npm run dev` 使用開發模式：登入頁直接選 `dispatcher@example.com` 登入。
- 正式環境要建立 Google OAuth 用戶端並設定環境變數，步驟見 [docs/auth.md](docs/auth.md)。

## 常用指令

| 指令 | 說明 |
|---|---|
| `npm run dev` | 啟動開發環境（資料庫、API、前端） |
| `npm test` | 執行核心模組與 API 的單元測試 |
| `npm run build` | 建置核心模組、API 與前端 |
| `npm run typecheck` | 全部套件的型別檢查 |
| `npm run db:reset` | 清空所有資料，重新匯入 `data/*.json` |

## 架構

| 目錄 | 內容 |
|---|---|
| `packages/core` | 時間軸計算、車趟組成、艙位分配、規則檢查、派車單內容。純 TypeScript，沒有 I/O，前後端共用，用 Vitest 測試。 |
| `apps/api` | NestJS + Prisma + PostgreSQL。Google 登入、CRUD、班表發布、操作紀錄。正式環境會一併提供前端靜態檔。 |
| `apps/web` | React + Vite + Ant Design（zh_TW）。調度看板、訂單、設定、司機與車輛、派車單、操作紀錄。 |
| `scripts/dev.mjs` | `npm run dev` 的啟動腳本。 |

## 畫面

- **調度看板**：左側是待派訂單，拖到右側司機列就會自動組成車趟、選灌油點、分配艙位；甘特時間軸 00:00–24:00，色塊分為行駛、灌油、卸油、等待；每列顯示收車時間、單數與規則狀態，違規原因直接列在時間軸下方。
- **訂單管理**：新增、修改、取消、恢復、標記完成，依日期與狀態查詢。
- **設定**：油站與營業時間、路段時間矩陣（標示來源，缺少的路段醒目標示）、作業時間與倍數、單數上限、排班規則開關與等級。存檔後看板立即重算。
- **司機與車輛**：所屬廠、班別、固定車輛、車頭與油槽車牌、艙位。
- **派車單**：已發布班表的派車單，可列印或存成圖片。
- **操作紀錄**：所有修改與發布紀錄，包含操作者與警告原因。
- **使用者（登入名單）**：在設定頁新增或移除可以登入的 Google 帳號。
