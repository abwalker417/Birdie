#!/usr/bin/env bash
set -euo pipefail
APP_DIR="/opt/birdie/app"
VENV="/opt/birdie/venv/bin"
APP_USER="birdie"
cd "$APP_DIR"
git config --global --add safe.directory "$APP_DIR" || true
git fetch origin
git reset --hard origin/main
su -c "$VENV/pip install -r $APP_DIR/backend/requirements.txt" "$APP_USER"
su -c "cd $APP_DIR/backend && $VENV/alembic upgrade head" "$APP_USER"
if [[ -f frontend/package-lock.json ]]; then
  su -c "cd $APP_DIR/frontend && npm ci && npm run build" "$APP_USER"
else
  su -c "cd $APP_DIR/frontend && npm install && npm run build" "$APP_USER"
fi
install -m 644 "$APP_DIR/deploy/supervisor/birdie-api.conf" /etc/supervisor/conf.d/birdie-api.conf
install -m 644 "$APP_DIR/deploy/supervisor/birdie-web.conf" /etc/supervisor/conf.d/birdie-web.conf
install -m 644 "$APP_DIR/deploy/nginx/birdie.conf" /etc/nginx/sites-available/birdie
ln -sf /etc/nginx/sites-available/birdie /etc/nginx/sites-enabled/birdie
supervisorctl reread >/dev/null || true
supervisorctl update >/dev/null || true
supervisorctl restart birdie-api >/dev/null || true
supervisorctl restart birdie-web >/dev/null || true
systemctl restart nginx
