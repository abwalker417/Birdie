#!/usr/bin/env bash
# Birdie — In-container installer (Debian 12)
# Run inside the LXC:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/abwalker417/Birdie/main/install.sh)"

set -euo pipefail

# ─── Config ─────────────────────────────────────────────────────────────────
APP="Birdie"
GITHUB_REPO="https://github.com/abwalker417/Birdie.git"
BIRDIE_DIR="/opt/birdie"
BIRDIE_USER="birdie"
DB_NAME="birdie"
DB_USER="birdie"
DB_PASS="$(openssl rand -hex 16 2>/dev/null || head -c16 /dev/urandom | xxd -p)"
JWT_SECRET="$(openssl rand -hex 32 2>/dev/null || head -c32 /dev/urandom | xxd -p)"

YW="\033[33m"; GN="\033[1;92m"; RD="\033[01;31m"; CL="\033[m"
BFR="\r\033[K"; CM="${GN}✓${CL}"; CROSS="${RD}✗${CL}"
msg_info()  { echo -ne "  ${YW}$1...${CL}"; }
msg_ok()    { echo -e "${BFR}  ${CM} ${GN}$1${CL}"; }
msg_error() { echo -e "${BFR}  ${CROSS} ${RD}$1${CL}"; exit 1; }

banner() {
cat <<'EOF'

  ██████╗ ██╗██████╗ ██████╗ ██╗███████╗
  ██╔══██╗██║██╔══██╗██╔══██╗██║██╔════╝
  ██████╔╝██║██████╔╝██║  ██║██║█████╗
  ██╔══██╗██║██╔══██╗██║  ██║██║██╔══╝
  ██████╔╝██║██║  ██║██████╔╝██║███████╗
  ╚═════╝ ╚═╝╚═╝  ╚═╝╚═════╝ ╚═╝╚══════╝
  Self-Hosted Golf Tracker

EOF
}

# ─── Preflight ──────────────────────────────────────────────────────────────
preflight() {
  [[ $EUID -eq 0 ]] || msg_error "Run as root"
  if ! grep -q "Debian GNU/Linux 12" /etc/os-release 2>/dev/null; then
    echo -e "${YW}Warning: this script targets Debian 12. Continuing anyway.${CL}"
  fi
  export DEBIAN_FRONTEND=noninteractive
}

# ─── Locale (so the perl warnings stop) ─────────────────────────────────────
setup_locale() {
  msg_info "Configuring locale"
  apt-get update -qq >/dev/null
  apt-get install -y -qq locales >/dev/null
  if ! grep -q "^en_US.UTF-8 UTF-8" /etc/locale.gen 2>/dev/null; then
    echo "en_US.UTF-8 UTF-8" >> /etc/locale.gen
  fi
  locale-gen en_US.UTF-8 >/dev/null
  update-locale LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 >/dev/null
  export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
  msg_ok "Locale en_US.UTF-8 configured"
}

# ─── System packages ────────────────────────────────────────────────────────
install_packages() {
  msg_info "Installing base packages"
  apt-get install -y -qq \
    curl wget git unzip ca-certificates gnupg lsb-release sudo openssl \
    build-essential \
    python3 python3-pip python3-venv python3-dev \
    nginx supervisor \
    >/dev/null \
    || msg_error "base apt-get install failed"
  msg_ok "Base packages installed"

  msg_info "Installing PostgreSQL + PostGIS"
  apt-get install -y -qq postgresql postgresql-contrib postgis >/dev/null \
    || msg_error "postgresql install failed"
  msg_ok "PostgreSQL + PostGIS installed"

  msg_info "Adding NodeSource (Node.js 20)"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1 \
    || msg_error "NodeSource setup failed"
  msg_ok "NodeSource configured"

  msg_info "Installing Node.js 20"
  apt-get install -y -qq nodejs >/dev/null \
    || msg_error "Node.js install failed"
  msg_ok "Node.js $(node --version) installed"
}

# ─── App user ───────────────────────────────────────────────────────────────
setup_user() {
  msg_info "Creating system user '$BIRDIE_USER'"
  if ! id "$BIRDIE_USER" >/dev/null 2>&1; then
    useradd --system --shell /bin/bash --create-home --home-dir "$BIRDIE_DIR" "$BIRDIE_USER"
  fi
  msg_ok "User '$BIRDIE_USER' ready"
}

# ─── PostgreSQL setup ───────────────────────────────────────────────────────
# We use `sudo -u postgres psql -v ON_ERROR_STOP=1` instead of su -c with nested
# quoting, which is what caused the previous "syntax error at end of input" /
# bare "DROP" failures.
setup_postgres() {
  msg_info "Starting PostgreSQL"
  systemctl enable --now postgresql >/dev/null 2>&1 || msg_error "Cannot start postgresql"
  # Wait for socket to be ready
  for _ in $(seq 1 20); do
    sudo -u postgres psql -c "SELECT 1" >/dev/null 2>&1 && break
    sleep 1
  done
  msg_ok "PostgreSQL running"

  msg_info "Provisioning database '$DB_NAME'"
  sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL >/dev/null
DROP DATABASE IF EXISTS "$DB_NAME";
DROP USER     IF EXISTS "$DB_USER";
CREATE USER "$DB_USER" WITH PASSWORD '$DB_PASS';
CREATE DATABASE "$DB_NAME" OWNER "$DB_USER";
GRANT ALL PRIVILEGES ON DATABASE "$DB_NAME" TO "$DB_USER";
SQL

  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" <<SQL >/dev/null
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;
GRANT ALL ON SCHEMA public TO "$DB_USER";
SQL
  msg_ok "Database + PostGIS extensions ready"

  msg_info "Configuring pg_hba.conf for local md5 auth"
  PG_HBA=$(sudo -u postgres psql -t -A -c "SHOW hba_file;")
  if [[ -f "$PG_HBA" ]]; then
    sed -i "/^# Birdie$/,/^# \/Birdie$/d" "$PG_HBA"
    {
      echo "# Birdie"
      echo "host    $DB_NAME    $DB_USER    127.0.0.1/32    md5"
      echo "host    $DB_NAME    $DB_USER    ::1/128         md5"
      echo "# /Birdie"
    } >> "$PG_HBA"
    sudo -u postgres psql -c "SELECT pg_reload_conf();" >/dev/null
  fi
  msg_ok "pg_hba.conf updated"
}

# ─── Clone repo ─────────────────────────────────────────────────────────────
clone_repo() {
  msg_info "Cloning Birdie from GitHub"
  if [[ -d "$BIRDIE_DIR/app/.git" ]]; then
    git -C "$BIRDIE_DIR/app" fetch origin >/dev/null 2>&1 || true
    git -C "$BIRDIE_DIR/app" reset --hard origin/main >/dev/null 2>&1 || true
  else
    rm -rf "$BIRDIE_DIR/app"
    git clone --depth 1 "$GITHUB_REPO" "$BIRDIE_DIR/app" >/dev/null \
      || msg_error "git clone failed — check that $GITHUB_REPO is public"
  fi
  git config --global --add safe.directory "$BIRDIE_DIR/app"
  chown -R "$BIRDIE_USER:$BIRDIE_USER" "$BIRDIE_DIR"
  msg_ok "Repo at $BIRDIE_DIR/app"
}

# ─── Backend (Python venv, .env, migrations) ───────────────────────────────
setup_backend() {
  msg_info "Creating Python venv"
  rm -rf "$BIRDIE_DIR/venv"
  python3 -m venv "$BIRDIE_DIR/venv" || msg_error "venv creation failed"
  "$BIRDIE_DIR/venv/bin/pip" install --upgrade pip wheel >/dev/null 2>&1
  msg_ok "venv created"

  msg_info "Installing Python dependencies"
  "$BIRDIE_DIR/venv/bin/pip" install -q -r "$BIRDIE_DIR/app/backend/requirements.txt" \
    || msg_error "pip install failed"
  msg_ok "Python deps installed"

  msg_info "Writing backend .env"
  cat > "$BIRDIE_DIR/app/backend/.env" <<ENV
DATABASE_URL=postgresql+asyncpg://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}
JWT_SECRET=${JWT_SECRET}
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=43200
ENV
  chown -R "$BIRDIE_USER:$BIRDIE_USER" "$BIRDIE_DIR"
  msg_ok ".env written"

  msg_info "Running database migrations"
  cd "$BIRDIE_DIR/app/backend"
  sudo -u "$BIRDIE_USER" "$BIRDIE_DIR/venv/bin/alembic" upgrade head \
    || msg_error "Alembic migration failed"
  msg_ok "Migrations applied"
}

# ─── Frontend build ─────────────────────────────────────────────────────────
setup_frontend() {
  msg_info "Installing frontend deps"
  cd "$BIRDIE_DIR/app/frontend"
  sudo -u "$BIRDIE_USER" npm install --silent --no-audit --no-fund \
    || msg_error "npm install failed"
  msg_ok "npm packages installed"

  msg_info "Building frontend"
  sudo -u "$BIRDIE_USER" npm run build --silent \
    || msg_error "npm run build failed"
  msg_ok "Frontend built"
}

# ─── Supervisor ─────────────────────────────────────────────────────────────
setup_supervisor() {
  msg_info "Configuring supervisor"
  cp "$BIRDIE_DIR/app/deploy/supervisor-birdie.conf" /etc/supervisor/conf.d/birdie.conf
  systemctl enable --now supervisor >/dev/null 2>&1
  supervisorctl reread >/dev/null
  supervisorctl update >/dev/null
  supervisorctl restart birdie-api >/dev/null 2>&1 || supervisorctl start birdie-api >/dev/null 2>&1 || true
  msg_ok "Supervisor running birdie-api"
}

# ─── nginx ──────────────────────────────────────────────────────────────────
setup_nginx() {
  msg_info "Configuring nginx on port 8080"
  cp "$BIRDIE_DIR/app/deploy/nginx-birdie.conf" /etc/nginx/sites-available/birdie
  ln -sf /etc/nginx/sites-available/birdie /etc/nginx/sites-enabled/birdie
  rm -f /etc/nginx/sites-enabled/default
  nginx -t >/dev/null 2>&1 || msg_error "nginx config test failed"
  systemctl enable --now nginx >/dev/null 2>&1
  systemctl restart nginx
  msg_ok "nginx serving on :8080"
}

# ─── Summary ────────────────────────────────────────────────────────────────
print_summary() {
  local ip
  ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  echo
  echo -e "${GN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${CL}"
  echo -e "${GN}  $APP installed${CL}"
  echo -e "${GN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${CL}"
  echo -e "  App URL  : ${YW}http://${ip}:8080${CL}"
  echo -e "  API docs : ${YW}http://${ip}:8080/api/docs${CL}"
  echo -e "  DB pass  : ${YW}${DB_PASS}${CL}"
  echo -e "  Update   : ${YW}bash $BIRDIE_DIR/app/update.sh${CL}"
  echo -e "${GN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${CL}"
  echo
  echo -e "${YW}First user to register at the URL becomes the admin.${CL}"
  echo -e "${YW}Do NOT edit files inside the container — use the GitHub repo + update.sh.${CL}"
  echo
}

# ─── Main ───────────────────────────────────────────────────────────────────
banner
preflight
setup_locale
install_packages
setup_user
setup_postgres
clone_repo
setup_backend
setup_frontend
setup_supervisor
setup_nginx
print_summary
