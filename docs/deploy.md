# 部署到 GCP（Cloud Run + Cloud SQL，台灣區 asia-east1）

全部在瀏覽器裡的 **Cloud Shell** 完成，不需要在自己電腦安裝 Node.js。

架構：

- **Cloud Run**：一個容器同時提供網頁與 API。沒人使用時縮到 0 個執行個體，不收運算費。
- **Cloud SQL for PostgreSQL**：資料庫，每天自動備份。
- **Secret Manager**：存放資料庫連線字串、Google 用戶端密碼、登入簽章密鑰。

容器每次啟動都會自動套用資料庫 migration；資料庫是空的時候，會匯入 `data/*.json` 的初始資料。

> 費用：Cloud SQL 即使沒人用也會持續計費（最小規格每月約數百元新台幣），Cloud Run 依使用量計費。實際金額以 GCP 價格頁為準。

## 步驟 0：開啟 Cloud Shell

1. 到 [console.cloud.google.com](https://console.cloud.google.com)，建立或選擇一個專案，並確認已啟用帳單。
2. 按右上角的「啟用 Cloud Shell」（`>_` 圖示），下方會開啟終端機。

以下指令都貼到 Cloud Shell 執行，**一次貼一個區塊**。

## 步驟 1：設定變數

把 `你的GCP專案ID` 換成實際的專案 ID（在主控台上方的專案選單可以看到）。

```bash
export PROJECT_ID=你的GCP專案ID
```

```bash
export REGION=asia-east1 SERVICE=tanker DB_INSTANCE=tanker-db
```

```bash
gcloud config set project $PROJECT_ID
```

```bash
export PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
```

```bash
echo "系統網址會是：https://$SERVICE-$PROJECT_NUMBER.$REGION.run.app"
```

把最後印出的網址記下來，步驟 5 會用到。

> Cloud Shell 閒置一段時間會斷線，斷線後變數會消失。重新連線後再執行一次步驟 1 即可。

## 步驟 2：啟用需要的服務

```bash
gcloud services enable run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

## 步驟 3：建立資料庫（約 10 分鐘）

```bash
gcloud sql instances create $DB_INSTANCE --database-version=POSTGRES_16 --edition=enterprise --tier=db-f1-micro --region=$REGION --storage-size=10 --backup-start-time=18:00
```

`--backup-start-time=18:00` 是 UTC，等於台灣時間凌晨 2 點自動備份。

```bash
gcloud sql databases create tanker --instance=$DB_INSTANCE
```

```bash
export DB_PASSWORD=$(openssl rand -hex 16)
```

```bash
gcloud sql users create tanker --instance=$DB_INSTANCE --password=$DB_PASSWORD
```

## 步驟 4：把密碼與密鑰存進 Secret Manager

資料庫連線字串：

```bash
printf '%s' "postgresql://tanker:$DB_PASSWORD@localhost/tanker?host=/cloudsql/$PROJECT_ID:$REGION:$DB_INSTANCE&connection_limit=5" | gcloud secrets create tanker-database-url --data-file=-
```

登入簽章密鑰：

```bash
openssl rand -hex 32 | tr -d '\n' | gcloud secrets create tanker-session-secret --data-file=-
```

## 步驟 5：建立 Google 登入用的 OAuth 用戶端

依 [docs/auth.md](auth.md) 的「建立 Google OAuth 用戶端」操作。「已授權的重新導向 URI」填步驟 1 的網址，後面加上 `/api/auth/callback`，例如：

```
https://tanker-123456789012.asia-east1.run.app/api/auth/callback
```

建立後把**用戶端密碼**存進 Secret Manager。執行下一行後，貼上密碼並按 Enter（畫面不會顯示）：

```bash
read -rs GOOGLE_CLIENT_SECRET && printf '%s' "$GOOGLE_CLIENT_SECRET" | gcloud secrets create tanker-google-client-secret --data-file=-
```

**用戶端 ID** 先記下來，步驟 7 會用到。

## 步驟 6：建立執行用的服務帳戶

讓 Cloud Run 可以連資料庫、讀取 Secret Manager，而且只有這兩個權限。

```bash
gcloud iam service-accounts create tanker-run --display-name="油罐車派車系統"
```

```bash
gcloud projects add-iam-policy-binding $PROJECT_ID --member="serviceAccount:tanker-run@$PROJECT_ID.iam.gserviceaccount.com" --role=roles/cloudsql.client
```

```bash
for s in tanker-database-url tanker-session-secret tanker-google-client-secret; do gcloud secrets add-iam-policy-binding $s --member="serviceAccount:tanker-run@$PROJECT_ID.iam.gserviceaccount.com" --role=roles/secretmanager.secretAccessor; done
```

## 步驟 7：下載程式並部署

```bash
git clone https://github.com/toastlin-spec/tanker-dispatch.git
```

> 如果這個 GitHub repo 是私人的，`git clone` 會要求帳號密碼：帳號填 GitHub 使用者名稱，密碼要貼 GitHub 的 Personal access token（在 GitHub 的 Settings → Developer settings 建立），不是登入密碼。

```bash
cd tanker-dispatch
```

建立部署設定檔：

```bash
cp deploy.env.example deploy.env
```

```bash
cloudshell edit deploy.env
```

在開啟的編輯器裡填好 `PROJECT_ID`、`GOOGLE_CLIENT_ID`（步驟 5）、`AUTH_BOOTSTRAP_EMAILS`（你自己的 Gmail），然後存檔。

部署（第一次需要 5～10 分鐘，會在雲端建置容器）：

```bash
bash scripts/deploy-cloudrun.sh
```

過程中如果詢問是否建立 Artifact Registry 儲存庫，回答 `Y`。

## 步驟 8：登入並加入調度員

1. 打開步驟 1 的網址，用 `AUTH_BOOTSTRAP_EMAILS` 裡的 Gmail 登入。
2. 到「設定 → 使用者（登入名單）」加入其他調度員的 Google 帳號。
3. 到「司機與車輛」把佔位資料（司機 A～D、車 1～4）改成真實資料。

## 之後更新程式

程式有新版本時，在 Cloud Shell 執行：

```bash
cd ~/tanker-dispatch && git pull && bash scripts/deploy-cloudrun.sh
```

`deploy.env` 存在 Cloud Shell 的家目錄，不會被 `git pull` 覆蓋。資料庫的 migration 會在新版本啟動時自動套用。

## 疑難排解

**看記錄**

```bash
gcloud run services logs read $SERVICE --region $REGION --limit 100
```

**網頁打不開，記錄出現「尚未設定登入方式」「必須設定 PUBLIC_URL」等訊息**

這是刻意的保護：登入設定不完整時，系統拒絕啟動。依訊息補上 `deploy.env` 或 Secret Manager 的設定後重新部署。

**按 Google 登入出現 `redirect_uri_mismatch`**

OAuth 用戶端的重新導向 URI 必須和網址完全一致（https、結尾是 `/api/auth/callback`、沒有多餘的斜線）。

**部署時出現建置權限錯誤（例如 Cloud Build 沒有權限）**

較新的專案用預設的運算服務帳戶建置，可能需要補權限：

```bash
gcloud projects add-iam-policy-binding $PROJECT_ID --member="serviceAccount:$PROJECT_NUMBER-compute@developer.gserviceaccount.com" --role=roles/run.builder
```

**部署時出現 `allUsers` 或「網域限制共用」相關錯誤**

公司組織的政策可能禁止公開的 Cloud Run 服務。系統本身有 Google 登入保護，但仍需要組織管理員允許這個服務公開，或改用 IAP。
