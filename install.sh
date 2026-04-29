#!/usr/bin/env bash
set -euo pipefail

APP="Birdie"
APP_DIR="/opt/birdie"
APP_USER="birdie"
REPO_URL="https://github.com/abwalker417/birdie"
DB_NAME="birdie"
DB_USER="birdie"
DB_PASS="$(openssl rand -hex 16)"
JWT_SECRET="$(openssl rand -hex 32)"

log(){ echo "[Birdie] $1"; }
fail(){ echo "[Birdie] ERROR: $1"; exit 1; }
[ "$EUID" -eq 0 ] || fail "Run as root"

apt-get update -qq
apt-get install -y sudo curl wget git unzip gnupg ca-certificates lsb-release build-essential   python3 python3-pip python3-venv python3-dev nginx supervisor postgresql postgresql-contrib   postgis libpq-dev

curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

id "$APP_USER" >/dev/null 2>&1 || useradd --system --shell /bin/bash --create-home --home-dir "$APP_DIR" "$APP_USER"
mkdir -p "$APP_DIR"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

systemctl enable postgresql
systemctl start postgresql
sleep 3

su - postgres -c "psql -c "DROP DATABASE IF EXISTS ${DB_NAME};"" || true
su - postgres -c "psql -c "DROP USER IF EXISTS ${DB_USER};"" || true
su - postgres -c "psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';""
su - postgres -c "psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};""
su - postgres -c "psql -d ${DB_NAME} -c 'CREATE EXTENSION IF NOT EXISTS postgis;'"
PG_HBA=$(su - postgres -c "psql -t -P format=unaligned -c 'SHOW hba_file'" | tr -d '[:space:]')
sed -i '/birdie/d' "$PG_HBA"
echo "host ${DB_NAME} ${DB_USER} 127.0.0.1/32 md5" >> "$PG_HBA"
echo "host ${DB_NAME} ${DB_USER} ::1/128 md5" >> "$PG_HBA"
systemctl reload postgresql

rm -rf "$APP_DIR/app"
git clone "$REPO_URL" "$APP_DIR/app"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

python3 -m venv "$APP_DIR/venv"
"$APP_DIR/venv/bin/pip" install --upgrade pip
"$APP_DIR/venv/bin/pip" install -r "$APP_DIR/app/backend/requirements.txt"

cat > "$APP_DIR/app/backend/.env" <<ENV
DATABASE_URL=postgresql+asyncpg://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}
SYNC_DATABASE_URL=postgresql+psycopg2://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}
JWT_SECRET=${JWT_SECRET}
APP_ENV=production
CORS_ORIGINS=http://localhost:8080
ENV
chown "$APP_USER":"$APP_USER" "$APP_DIR/app/backend/.env"

cd "$APP_DIR/app/backend"
su -s /bin/bash -c "$APP_DIR/venv/bin/python -m alembic upgrade head" "$APP_USER"

cd "$APP_DIR/app/frontend"
su -s /bin/bash -c "npm install" "$APP_USER"
su -s /bin/bash -c "npm run build" "$APP_USER"

cat > /etc/supervisor/conf.d/birdie.conf <<SUP
[program:birdie-api]
command=${APP_DIR}/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --workers 2
directory=${APP_DIR}/app/backend
user=${APP_USER}
autostart=true
autorestart=true
stderr_logfile=/var/log/birdie-api.err.log
stdout_logfile=/var/log/birdie-api.out.log
environment=HOME="${APP_DIR}",USER="${APP_USER}"
SUP
systemctl enable supervisor
systemctl restart supervisor
supervisorctl reread
supervisorctl update
supervisorctl restart birdie-api || true

cat > /etc/nginx/sites-available/birdie <<NGINX
server {
  listen 8080;
  server_name _;
  root ${APP_DIR}/app/frontend/dist;
  index index.html;

  location = /index.html { add_header Cache-Control "no-store, must-revalidate" always; try_files $uri =404; }
  location = /sw.js { add_header Cache-Control "no-store, must-revalidate" always; try_files $uri =404; }
  location = /manifest.webmanifest { add_header Cache-Control "no-store, must-revalidate" always; try_files $uri =404; }
  location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable" always; try_files $uri =404; }
  location /api/ {
    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 60s;
  }
  location / { try_files $uri /index.html; }
}
NGINX
ln -sf /etc/nginx/sites-available/birdie /etc/nginx/sites-enabled/birdie
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl restart nginx

cat > "$APP_DIR/app/update.sh" <<'UPD'
#!/usr/bin/env bash
set -euo pipefail
cd /opt/birdie/app

git config --global --add safe.directory /opt/birdie/app >/dev/null 2>&1 || true
old_head=$(git rev-parse HEAD)
git fetch origin
new_head=$(git rev-parse origin/main)
if [ "$old_head" = "$new_head" ]; then
  echo "Already up to date"
  exit 0
fi
changed=$(git diff --name-only "$old_head" "$new_head")
git reset --hard origin/main

echo "$changed" | grep -q '^backend/requirements.txt$' && /opt/birdie/venv/bin/pip install -r /opt/birdie/app/backend/requirements.txt
if echo "$changed" | grep -q '^backend/\|^backend/alembic/'; then
  cd /opt/birdie/app/backend
  /opt/birdie/venv/bin/python -m alembic upgrade head
  supervisorctl restart birdie-api
fi
if echo "$changed" | grep -q '^frontend/'; then
  cd /opt/birdie/app/frontend
  npm install
  npm run build
  systemctl reload nginx
fi

echo "Update complete"
UPD
chmod +x "$APP_DIR/app/update.sh"

IP=$(hostname -I | awk '{print $1}')
log "Installed successfully"
log "URL: http://${IP}:8080"
log "API docs: http://${IP}:8080/api/docs"
