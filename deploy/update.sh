#!/usr/bin/env bash
# Update the code (git pull, or after unpacking a new kaarobarly.tar.gz) and restart the API. Run on the server:
#   cd /var/www/kaarobarly && bash deploy/update.sh
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

node deploy/backup.mjs || echo "(no database to back up yet)"   # safety copy before changing anything
if [ -d .git ]; then git pull --ff-only; fi
PORT="$(grep -E '^PORT=' apps/api/.env | cut -d= -f2)"
PORT="${PORT:-4100}"
cd apps/api
npm ci --omit=dev
pm2 reload ecosystem.config.cjs
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/health"; then echo; echo "Updated."; exit 0; fi
  sleep 1
done
echo "The API did not come back. Check: pm2 logs kaarobarly-api --lines 40"
exit 1
