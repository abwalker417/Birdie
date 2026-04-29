#!/usr/bin/env bash
# Birdie Golf Tracker - Proxmox LXC Install Script
# Usage: bash -c "$(curl -fsSL https://raw.githubusercontent.com/abwalker417/birdie/main/install.sh)"

set -euo pipefail

# ─── Colours ────────────────────────────────────────────────────────────────
YW="\033[33m"
GN="\033[1;92m"
RD="\033[01;31m"
CL="\033[m"
BFR="\r\033[K"
HOLD=" "
CM="${GN}✓${CL}"
CROSS="${RD}✗${CL}"

# ─── Config ──────────────────────────────────────────────────────────────────
APP="Birdie"
BIRDIE_DIR="/opt/birdie"
BIRDIE_USER="birdie"
GITHUB_REPO="https://github.com/abwalker417/birdie"
DB_NAME="birdie"
DB_USER="birdie"
DB_PASS=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)

# ─── Helpers ────────────────────────────────────────────────────────────────
msg_info()  { local msg="$1"; echo -ne " ${HOLD} ${YW}${msg}...${CL}"; }
msg_ok()    { local msg="$1"; echo -e "${BFR} ${CM} ${GN}${msg}${CL}"; }
msg_error() { local msg="$1"; echo -e "${BFR} ${CROSS} ${RD}${msg}${CL}"; exit 1; }

header_info() {
cat <<"EOF"

  ██████╗ ██╗██████╗ ██████╗ ██╗███████╗
  ██╔══██╗██║██╔══██╗██╔══██╗██║██╔════╝
  ██████╔╝██║██████╔╝██║  ██║██║█████╗
  ██╔══██╗██║██╔══██╗██║  ██║██║██╔══╝
  ██████╔╝██║██║  ██║██████╔╝██║███████╗
  ╚═════╝ ╚═╝╚═╝  ╚═╝╚═════╝ ╚═╝╚══════╝
  Golf Tracker — Self-Hosted

EOF
}

# ─── Preflight ───────────────────────────────────────────────────────────────
check_root() {
  if [[ $EUID -ne 0 ]]; then
    msg_error "Run as root (sudo bash install.sh)"
  fi
}

check_os() {
  if ! grep -q "Debian GNU/Linux 12" /etc/os-release 2>/dev/null; then
    echo -e "${YW}Warning: This script targets Debian 12. Proceeding anyway...${CL}"
  fi
}

# ─── Install Steps ───────────────────────────────────────────────────────────
install_dependencies() {
  msg_info "Updating apt"
  apt-get update -qq 2>&1 | tail -1
  msg_ok "apt updated"

  msg_info "Installing sudo"
  apt-get install -y sudo >/dev/null
  msg_ok "sudo installed"

  msg_info "Installing base dependencies"
  apt-get install -y \
    curl wget git unzip gnupg ca-certificates lsb-release \
    build-essential \
    python3 python3-pip python3-venv python3-dev \
    nginx supervisor \
    || msg_error "Base dependency install failed"
  msg_ok "Base dependencies installed"

  msg_info "Installing PostgreSQL + PostGIS"
  apt-get install -y postgresql postgresql-contrib postgis \
    || msg_error "PostgreSQL install failed"
  msg_ok "PostgreSQL + PostGIS installed"

  msg_info "Adding Node.js 20 repo"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    || msg_error "NodeSource setup failed"
  msg_ok "NodeSource repo added"

  msg_info "Installing Node.js 20"
  apt-get install -y nodejs \
    || msg_error "Node.js install failed"
  msg_ok "Node.js $(node --version) installed"
}

setup_user() {
  msg_info "Creating birdie system user"
  if ! id "$BIRDIE_USER" &>/dev/null; then
    useradd --system --shell /bin/bash --create-home --home-dir "$BIRDIE_DIR" "$BIRDIE_USER"
  fi
  msg_ok "User '$BIRDIE_USER' ready"
}

setup_postgres() {
  msg_info "Configuring PostgreSQL + PostGIS"
  systemctl enable postgresql
  systemctl start postgresql
  sleep 5

  su -c "psql -c \"DROP DATABASE IF EXISTS ${DB_NAME};\"" postgres 2>/dev/null || true
  su -c "psql -c \"DROP USER IF EXISTS ${DB_USER};\"" postgres 2>/dev/null || true
  su -c "psql -c \"CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';\"" postgres \
    || msg_error "Failed to create DB user"
  su -c "psql -c \"CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};\"" postgres \
    || msg_error "Failed to create database"
  su -c "psql -d ${DB_NAME} -c \"CREATE EXTENSION IF NOT EXISTS postgis;\"" postgres \
    || msg_error "PostGIS extension failed -- is postgis installed?"
  su -c "psql -d ${DB_NAME} -c \"CREATE EXTENSION IF NOT EXISTS postgis_topology;\"" postgres 2>/dev/null || true
  su -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};\"" postgres

  PG_HBA=$(su -c "psql -t -c \"SHOW hba_file;\"" postgres | tr -d '[:space:]')
  sed -i '/birdie/d' "$PG_HBA"
  echo "host    ${DB_NAME}    ${DB_USER}    127.0.0.1/32    md5" >> "$PG_HBA"
  echo "host    ${DB_NAME}    ${DB_USER}    ::1/128         md5" >> "$PG_HBA"
  su -c "psql -c \"SELECT pg_reload_conf();\"" postgres

  msg_ok "PostgreSQL + PostGIS configured"
}

clone_repo() {
  msg_info "Cloning Birdie from GitHub"
  if [[ -d "$BIRDIE_DIR/app" ]]; then
    rm -rf "$BIRDIE_DIR/app"
  fi
  git clone "$GITHUB_REPO" "$BIRDIE_DIR/app" \
    || msg_error "Git clone failed — check GITHUB_REPO URL in script"
  chown -R "$BIRDIE_USER:$BIRDIE_USER" "$BIRDIE_DIR"
  msg_ok "Repo cloned"
}

setup_backend() {
  msg_info "Setting up Python backend"
  rm -rf "$BIRDIE_DIR/venv"
  python3 -m venv "$BIRDIE_DIR/venv" \
    || msg_error "venv creation failed"
  "$BIRDIE_DIR/venv/bin/pip" install --upgrade pip
  "$BIRDIE_DIR/venv/bin/pip" install -r "$BIRDIE_DIR/app/backend/requirements.txt" \
    || msg_error "pip install failed"
  msg_ok "Python venv + dependencies installed"

  msg_info "Writing backend .env"
  cat > "$BIRDIE_DIR/app/backend/.env" <<ENV
DATABASE_URL=postgresql+asyncpg://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}
SYNC_DATABASE_URL=postgresql+psycopg2://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}
JWT_SECRET=${JWT_SECRET}
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=43200
ENV
  chown "$BIRDIE_USER:$BIRDIE_USER" "$BIRDIE_DIR/app/backend/.env"
  msg_ok ".env written"

  msg_info "Running database migrations"
  cd "$BIRDIE_DIR/app/backend"
  su -c "psql -d ${DB_NAME} -c \"DROP TABLE IF EXISTS alembic_version;\"" postgres 2>/dev/null || true
  su -c "$BIRDIE_DIR/venv/bin/python -m alembic upgrade head" "$BIRDIE_USER" \
    || msg_error "Alembic migrations failed"
  msg_ok "Database migrations applied"
}

setup_frontend() {
  msg_info "Building React frontend"
  cd "$BIRDIE_DIR/app/frontend"
  su -c "npm install" "$BIRDIE_USER" \
    || msg_error "npm install failed"
  su -c "npm run build" "$BIRDIE_USER" \
    || msg_error "npm build failed"
  msg_ok "Frontend built"
}

setup_supervisor() {
  msg_info "Configuring supervisor for backend"
  cat > /etc/supervisor/conf.d/birdie.conf <<CONF
[program:birdie-api]
command=${BIRDIE_DIR}/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --workers 2
directory=${BIRDIE_DIR}/app/backend
user=${BIRDIE_USER}
autostart=true
autorestart=true
stderr_logfile=/var/log/birdie-api.err.log
stdout_logfile=/var/log/birdie-api.out.log
environment=HOME="${BIRDIE_DIR}",USER="${BIRDIE_USER}"
CONF

  systemctl enable supervisor
  systemctl start supervisor
  supervisorctl reread
  supervisorctl update
  supervisorctl start birdie-api || true
  msg_ok "Supervisor configured"
}

setup_nginx() {
  msg_info "Configuring nginx"
  cat > /etc/nginx/sites-available/birdie <<NGINX
server {
    listen 8080;
    server_name _;

    root ${BIRDIE_DIR}/app/frontend/dist;
    index index.html;

    location = /index.html {
        add_header Cache-Control "no-store, must-revalidate" always;
        add_header Pragma "no-cache" always;
        try_files \$uri =404;
    }

    location = /sw.js {
        add_header Cache-Control "no-store, must-revalidate" always;
        try_files \$uri =404;
    }

    location = /manifest.webmanifest {
        add_header Cache-Control "no-store, must-revalidate" always;
        try_files \$uri =404;
    }

    location = /registerSW.js {
        add_header Cache-Control "no-store, must-revalidate" always;
        try_files \$uri =404;
    }

    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        try_files \$uri =404;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 60s;
    }

    location /ws/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX

  ln -sf /etc/nginx/sites-available/birdie /etc/nginx/sites-enabled/birdie
  rm -f /etc/nginx/sites-enabled/default
  nginx -t || msg_error "nginx config test failed"
  systemctl enable nginx >/dev/null
  systemctl restart nginx
  msg_ok "nginx configured"
}

print_summary() {
  local ip
  ip=$(hostname -I | awk '{print $1}')
  echo -e "\n${GN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${CL}"
  echo -e "${GN}  ${APP} installed successfully!${CL}"
  echo -e "${GN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${CL}"
  echo -e "  Local URL : ${YW}http://${ip}:8080${CL}"
  echo -e "  API docs  : ${YW}http://${ip}:8080/api/docs${CL}"
  echo -e "  DB pass   : ${YW}${DB_PASS}${CL}"
  echo -e "  Logs      : ${YW}journalctl -u supervisor${CL}"
  echo -e "${GN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${CL}\n"
}

header_info
check_root
check_os
install_dependencies
setup_user
setup_postgres
clone_repo
setup_backend
setup_frontend
setup_supervisor
setup_nginx
print_summary
