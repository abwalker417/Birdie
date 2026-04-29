#!/usr/bin/env bash
set -euo pipefail
APP_DIR="/opt/birdie"
APP_USER="birdie"
REPO_URL="https://github.com/REPLACE_ME/Birdie.git"
REPO_BRANCH="main"
APP_PORT="8080"
DB_NAME="birdie"
DB_USER="birdie"
DB_PASS="$(openssl rand -hex 16)"
JWT_SECRET="$(openssl rand -hex 32)"
info(){ echo "[Birdie] $*"; }
fail(){ echo "[Birdie] ERROR: $*"; exit 1; }
[[ $EUID -eq 0 ]] || fail "Run as root"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y curl wget git sudo ca-certificates gnupg lsb-release unzip build-essential python3 python3-pip python3-venv python3-dev nginx supervisor postgresql postgresql-contrib postgis postgresql-15-postgis-3 || fail "apt install failed"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - || fail "NodeSource setup failed"
  apt-get install -y nodejs || fail "Node.js install failed"
fi
id "$APP_USER" >/dev/null 2>&1 || useradd --system --shell /bin/bash --create-home --home-dir "$APP_DIR" "$APP_USER"
mkdir -p "$APP_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
systemctl enable postgresql >/dev/null 2>&1
systemctl restart postgresql
sleep 4
su -c "psql -c "DROP DATABASE IF EXISTS $DB_NAME;"" postgres >/dev/null 2>&1 || true
su -c "psql -c "DROP USER IF EXISTS $DB_USER;"" postgres >/dev/null 2>&1 || true
su -c "psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"" postgres || fail "Create DB user failed"
su -c "psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"" postgres || fail "Create DB failed"
su -c "psql -d $DB_NAME -c "CREATE EXTENSION IF NOT EXISTS postgis;"" postgres || fail "Enable PostGIS failed"
PG_HBA=$(su -c "psql -t -c "SHOW hba_file;"" postgres | xargs)
sed -i '/birdie/d' "$PG_HBA"
echo "host $DB_NAME $DB_USER 127.0.0.1/32 md5" >> "$PG_HBA"
echo "host $DB_NAME $DB_USER ::1/128 md5" >> "$PG_HBA"
su -c "psql -c "SELECT pg_reload_conf();"" postgres >/dev/null
rm -rf "$APP_DIR/app"
su -c "git clone --branch $REPO_BRANCH $REPO_URL $APP_DIR/app" "$APP_USER" || fail "git clone failed"
python3 -m venv "$APP_DIR/venv"
"$APP_DIR/venv/bin/pip" install --upgrade pip wheel
"$APP_DIR/venv/bin/pip" install -r "$APP_DIR/app/backend/requirements.txt" || fail "backend pip install failed"
cat > "$APP_DIR/app/backend/.env" <<ENVEOF
DATABASE_URL=postgresql+asyncpg://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME
JWT_SECRET=$JWT_SECRET
APP_ENV=production
CORS_ORIGINS=http://localhost:$APP_PORT,http://127.0.0.1:$APP_PORT
ENVEOF
chown "$APP_USER:$APP_USER" "$APP_DIR/app/backend/.env"
su -c "cd $APP_DIR/app/backend && $APP_DIR/venv/bin/alembic upgrade head" "$APP_USER" || fail "migrations failed"
su -c "cd $APP_DIR/app/frontend && npm install" "$APP_USER" || fail "npm install failed"
su -c "cd $APP_DIR/app/frontend && npm run build" "$APP_USER" || fail "npm build failed"
install -m 644 "$APP_DIR/app/deploy/supervisor/birdie-api.conf" /etc/supervisor/conf.d/birdie-api.conf
install -m 644 "$APP_DIR/app/deploy/supervisor/birdie-web.conf" /etc/supervisor/conf.d/birdie-web.conf
install -m 644 "$APP_DIR/app/deploy/nginx/birdie.conf" /etc/nginx/sites-available/birdie
ln -sf /etc/nginx/sites-available/birdie /etc/nginx/sites-enabled/birdie
rm -f /etc/nginx/sites-enabled/default
install -m 755 "$APP_DIR/app/update.sh" "$APP_DIR/update.sh"
supervisorctl reread >/dev/null || true
supervisorctl update >/dev/null || true
supervisorctl restart birdie-api >/dev/null || true
supervisorctl restart birdie-web >/dev/null || true
systemctl enable supervisor nginx >/dev/null 2>&1
systemctl restart supervisor nginx
IP=$(hostname -I | awk '{print $1}')
echo "App: http://$IP:$APP_PORT"
echo "API docs: http://$IP:$APP_PORT/api/docs"
