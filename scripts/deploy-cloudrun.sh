#!/usr/bin/env bash
# 部署或更新 Cloud Run 服務（在 Cloud Shell 的專案根目錄執行）。
# 第一次部署前請先完成 docs/deploy.md 的步驟 1～6。
#
# 用法：
#   bash scripts/deploy-cloudrun.sh
#
# 會讀取專案根目錄的 deploy.env（不會 commit），內容範例見 deploy.env.example。
set -euo pipefail

cd "$(dirname "$0")/.."
if [[ -f deploy.env ]]; then
  # shellcheck disable=SC1091
  source deploy.env
fi

: "${PROJECT_ID:?請在 deploy.env 設定 PROJECT_ID}"
: "${GOOGLE_CLIENT_ID:?請在 deploy.env 設定 GOOGLE_CLIENT_ID}"
: "${AUTH_BOOTSTRAP_EMAILS:?請在 deploy.env 設定 AUTH_BOOTSTRAP_EMAILS（例如你的 Gmail）}"
REGION="${REGION:-asia-east1}"
SERVICE="${SERVICE:-tanker}"
DB_INSTANCE="${DB_INSTANCE:-tanker-db}"
RUN_SA="${RUN_SA:-tanker-run@${PROJECT_ID}.iam.gserviceaccount.com}"

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
PUBLIC_URL="${PUBLIC_URL:-https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app}"

echo "專案：$PROJECT_ID　區域：$REGION　服務：$SERVICE"
echo "網址：$PUBLIC_URL"

gcloud run deploy "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --source . \
  --service-account "$RUN_SA" \
  --add-cloudsql-instances "${PROJECT_ID}:${REGION}:${DB_INSTANCE}" \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 2 \
  --set-env-vars "PUBLIC_URL=${PUBLIC_URL},GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID},AUTH_BOOTSTRAP_EMAILS=${AUTH_BOOTSTRAP_EMAILS}" \
  --set-secrets "DATABASE_URL=tanker-database-url:latest,SESSION_SECRET=tanker-session-secret:latest,GOOGLE_CLIENT_SECRET=tanker-google-client-secret:latest"

echo
echo "完成：打開 $PUBLIC_URL 用 Google 帳號登入。"
