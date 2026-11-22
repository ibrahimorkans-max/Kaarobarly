#!/usr/bin/env bash
# First-time setup on a fresh Ubuntu 22.04/24.04 VPS. Run as a sudo user:
#   (code in /var/www/kaarobarly: git clone, or unpack kaarobarly.tar.gz there)
#   cd /var/www/kaarobarly && bash deploy/setup.sh kaarobarly.zhtrader.com
set -euo pipefail

DOMAIN="${1:-}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
API_DIR="$APP_DIR/apps/api"
DATA_DIR="$APP_DIR/data"

echo "==> Installing Node.js 22, Nginx and PM2"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
sudo apt-get install -y nginx
command -v pm2 >/dev/null || sudo npm install -g pm2

echo "==> Installing API packages"
cd "$API_DIR"
npm ci --omit=dev

mkdir -p "$DATA_DIR" "$APP_DIR/backups"

if [ ! -f "$API_DIR/.env" ]; then
  echo "==> Creating apps/api/.env with a new secret"
  sed -e "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 48)|" \
      -e "s|^DB_PATH=.*|DB_PATH=$DATA_DIR/kaarobarly.db|" \
      .env.example > .env
  chmod 600 .env
fi

PORT="$(grep -E '^PORT=' "$API_DIR/.env" | cut -d= -f2)"
PORT="${PORT:-4100}"

echo "==> Starting the API with PM2 (port $PORT)"
pm2 startOrReload ecosystem.config.cjs
pm2 save
sudo env PATH="$PATH" pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null

echo "==> Waiting for the API to answer"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/health"; then echo; break; fi
  if [ "$i" = 30 ]; then echo "The API did not start. Check: pm2 logs kaarobarly-api --lines 40"; fi
  sleep 1
done

if [ -n "$DOMAIN" ]; then
  echo "==> Configuring Nginx for $DOMAIN"
  sed -e "s/api.example.com/$DOMAIN/g" -e "s/127.0.0.1:4100/127.0.0.1:$PORT/" "$APP_DIR/deploy/nginx-kaarobarly.conf" | sudo tee /etc/nginx/sites-available/kaarobarly >/dev/null
  sudo ln -sf /etc/nginx/sites-available/kaarobarly /etc/nginx/sites-enabled/kaarobarly
  sudo nginx -t && sudo systemctl reload nginx
  echo "==> Next: point $DOMAIN's DNS A record at this server, then run:"
  echo "    sudo apt-get install -y certbot python3-certbot-nginx && sudo certbot --nginx -d $DOMAIN"
fi

echo "==> Daily database backup at 02:30 (kept 14 days)"
# (`crontab -l` fails when there is no crontab yet and grep fails on empty input; neither may stop the script.)
CRON_LINE="30 2 * * * cd $API_DIR && $(command -v node) $APP_DIR/deploy/backup.mjs >> $APP_DIR/backups/backup.log 2>&1"
{ { crontab -l 2>/dev/null || true; } | { grep -v 'deploy/backup.mjs' || true; }; echo "$CRON_LINE"; } | crontab -

echo "Done. Logs: pm2 logs kaarobarly-api"
