# 登入設定（Google 帳號）

系統只允許「登入名單」上的 Google 帳號使用。名單上的人都能在「設定 → 使用者（登入名單）」新增或移除其他人；被移除的人立即無法使用系統。

## 運作方式

- 使用者按「使用 Google 帳號登入」→ 到 Google 選帳號 → 回到系統。
- 系統確認 Google 帳號的 email 已驗證，而且在名單上，才發給登入憑證（HttpOnly cookie，預設 12 小時有效）。
- 每次操作都會重新確認名單，所以移除後立即生效。
- 操作紀錄會記下每一筆修改是哪個帳號做的，包含發布時填寫的警告原因。
- 部署設定 `AUTH_BOOTSTRAP_EMAILS` 裡的帳號一律可以登入，而且不能在系統內移除，避免名單被誤刪時所有人都進不來。

## 本機開發

沒有設定 `GOOGLE_CLIENT_ID` 時，`npm run dev` 會使用「開發模式登入」：登入頁直接選名單中的帳號（預設 `dispatcher@example.com`），不經過 Google。

開發模式只能在本機使用：設定 `NODE_ENV=production` 或在 Cloud Run 上執行時，API 會拒絕啟動。

## 建立 Google OAuth 用戶端

在 GCP 主控台（[console.cloud.google.com](https://console.cloud.google.com)）選好專案後：

1. **設定同意畫面**：到「API 和服務」→「OAuth 同意畫面」（新版介面叫「Google Auth Platform」）。
   - 使用者類型選「外部」（大家用的是一般 Gmail 帳號）。
   - 填寫應用程式名稱（例如「油罐車派車系統」）、使用者支援 email、開發人員聯絡 email。
   - 範圍（Scopes）只需要 `openid`、`email`、`profile`，不用加其他項目。
   - 發布狀態：維持「測試中」時，每位使用者還要加到「測試使用者」名單；只用上面三個基本範圍時，可以直接按「發布應用程式」改成正式版，不需要 Google 審核。
2. **建立用戶端 ID**：到「憑證」→「建立憑證」→「OAuth 用戶端 ID」（新版介面在「用戶端」）。
   - 應用程式類型：「網頁應用程式」。
   - 已授權的重新導向 URI（要完全一致，包含 `https`、沒有結尾斜線）：
     - 正式環境：`https://你的網址/api/auth/callback`，例如 `https://tanker-xxxx.a.run.app/api/auth/callback`
     - 本機測試 Google 登入時（選填）：`http://localhost:5173/api/auth/callback`
   - 建立後複製「用戶端 ID」與「用戶端密碼」。

## 環境變數

| 變數 | 說明 |
|---|---|
| `GOOGLE_CLIENT_ID` | 上一步的用戶端 ID |
| `GOOGLE_CLIENT_SECRET` | 上一步的用戶端密碼（正式環境請放在 Secret Manager） |
| `SESSION_SECRET` | 簽章密鑰，至少 32 個字元，可用 `openssl rand -hex 32` 產生（請放在 Secret Manager）。更換後所有人都要重新登入。 |
| `PUBLIC_URL` | 使用者看到的網址，例如 `https://tanker-xxxx.a.run.app`。正式環境必填，必須是 https。 |
| `AUTH_BOOTSTRAP_EMAILS` | 一律允許登入的帳號，逗號分隔，例如你自己的 Gmail。 |
| `AUTH_SESSION_HOURS` | 登入後多久要重新登入，預設 12 小時。 |

設定不完整時（例如缺少用戶端密碼、`SESSION_SECRET` 太短、正式環境沒有 `PUBLIC_URL`），API 會拒絕啟動並顯示原因，不會在沒有登入保護的情況下運作。

## 第一次上線

1. 依上面步驟建立 OAuth 用戶端。
2. 部署時設定環境變數，`AUTH_BOOTSTRAP_EMAILS` 填你自己的 Gmail。
3. 用你的 Gmail 登入，到「設定 → 使用者（登入名單）」加入其他調度員的 Google 帳號。

## 注意事項

- 名單上的每個人都能管理名單；有人離職時請記得移除。
- 登出只會清掉這台電腦的登入狀態。如果懷疑帳號外洩，請把它從名單移除（立即生效），必要時更換 `SESSION_SECRET` 讓所有人重新登入。
