#!/usr/bin/env bash
# Build the web app for https://<your domain>/app and upload it to the server. Run from the repo root:
#   bash deploy/push-web.sh ubuntu@13.62.229.16 ~/Downloads/Kaarobarly.pem
# The server serves it from /var/www/kaarobarly/web-app (see apps/api/src/app.ts, WEB_APP_DIR to change).
set -euo pipefail
HOST="${1:?usage: push-web.sh user@host path/to/key.pem}"
KEY="${2:?usage: push-web.sh user@host path/to/key.pem}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Building the web app (base path /app)"
cd "$ROOT/apps/mobile"
# MSYS_NO_PATHCONV stops Git Bash on Windows turning /app into a Windows folder path
MSYS_NO_PATHCONV=1 WEB_BASE_URL=/app npx expo export -p web --output-dir dist-web --clear
grep -q 'src="/app/_expo' dist-web/index.html || { echo "The build does not use /app; stopping."; exit 1; }

echo "==> Uploading"
tar -czf "$ROOT/web-app.tgz" -C dist-web .
scp -o StrictHostKeyChecking=no -i "$KEY" "$ROOT/web-app.tgz" "$HOST:/tmp/web-app.tgz"
ssh -o StrictHostKeyChecking=no -i "$KEY" "$HOST" 'set -e; cd /var/www/kaarobarly; rm -rf web-app.new; mkdir web-app.new; tar -xzf /tmp/web-app.tgz -C web-app.new; rm -rf web-app.old; [ -d web-app ] && mv web-app web-app.old; mv web-app.new web-app; rm -rf web-app.old /tmp/web-app.tgz; echo "web app installed"'
rm -f "$ROOT/web-app.tgz"
echo "==> Done: open https://<your domain>/app"
