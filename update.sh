#!/usr/bin/env bash
# Birdie — repo-driven updater.
# Run inside the LXC:  bash /opt/birdie/app/update.sh
#
# Pulls main, hard-resets to origin/main, then only rebuilds the parts that
# actually changed. Safe to run repeatedly. NEVER edits files in-container.

set -euo pipefail

APP_DIR="/opt/birdie/app"
BIRDIE_USER="birdie"
VENV="/opt/birdie/venv"

YW="\033[33m"; GN="\033[1;92m"; RD="\033[01;31m"; CL="\033[m"
info()  { echo -e "${YW}▶${CL} $*"; }
ok()    { echo -e "${GN}✓${CL} $*"; }
fail()  { echo -e "${RD}✗${CL} $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "Run as root (or via 'pct exec <CTID> -- bash $APP_DIR/update.sh')"
[[ -d "$APP_DIR/.git" ]] || fail "$APP_DIR is not a git repo — was install.sh ever run?"

git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
chown -R "$BIRDIE_USER:$BIRDIE_USER" "$APP_DIR"

cd "$APP_DIR"
OLD_REV=$(git rev-parse HEAD)

info "Fetching origin"
git fetch origin --quiet || fail "git fetch failed — check network / repo URL"

NEW_REV=$(git rev-parse origin/main)
if [[ "$OLD_REV" == "$NEW_REV" ]]; then
  ok "Already at $(git rev-parse --short HEAD) — nothing to update"
  exit 0
fi

info "Resetting to origin/main ($(git rev-parse --short "$NEW_REV"))"
git reset --hard origin/main --quiet
ok "Working tree synced"

# What changed?
CHANGED=$(git diff --name-only "$OLD_REV" "$NEW_REV")
echo "$CHANGED" | sed 's/^/    /'

NEED_PIP=0; NEED_MIGRATE=0; NEED_FRONTEND=0; NEED_API_RESTART=0
NEED_NGINX=0; NEED_SUPERVISOR=0
while IFS= read -r f; do
  case "$f" in
    backend/requirements.txt)         NEED_PIP=1; NEED_API_RESTART=1 ;;
    backend/migrations/versions/*)    NEED_MIGRATE=1; NEED_API_RESTART=1 ;;
    backend/*)                         NEED_API_RESTART=1 ;;
    frontend/package.json|frontend/package-lock.json|frontend/*) NEED_FRONTEND=1 ;;
    deploy/nginx-birdie.conf)         NEED_NGINX=1 ;;
    deploy/supervisor-birdie.conf)    NEED_SUPERVISOR=1 ;;
  esac
done <<< "$CHANGED"

if [[ $NEED_PIP -eq 1 ]]; then
  info "Updating Python dependencies"
  "$VENV/bin/pip" install -q -r "$APP_DIR/backend/requirements.txt" || fail "pip install failed"
  ok "Python deps updated"
fi

if [[ $NEED_MIGRATE -eq 1 ]]; then
  info "Running new migrations"
  cd "$APP_DIR/backend"
  sudo -u "$BIRDIE_USER" "$VENV/bin/alembic" upgrade head || fail "Alembic upgrade failed"
  cd "$APP_DIR"
  ok "Migrations applied"
fi

if [[ $NEED_FRONTEND -eq 1 ]]; then
  info "Rebuilding frontend"
  cd "$APP_DIR/frontend"
  sudo -u "$BIRDIE_USER" npm install --silent --no-audit --no-fund || fail "npm install failed"
  sudo -u "$BIRDIE_USER" npm run build --silent || fail "npm run build failed"
  cd "$APP_DIR"
  ok "Frontend rebuilt"
fi

if [[ $NEED_NGINX -eq 1 ]]; then
  info "Reloading nginx config"
  cp "$APP_DIR/deploy/nginx-birdie.conf" /etc/nginx/sites-available/birdie
  nginx -t >/dev/null 2>&1 || fail "nginx config invalid"
  systemctl reload nginx
  ok "nginx reloaded"
fi

if [[ $NEED_SUPERVISOR -eq 1 ]]; then
  info "Updating supervisor program"
  cp "$APP_DIR/deploy/supervisor-birdie.conf" /etc/supervisor/conf.d/birdie.conf
  supervisorctl reread >/dev/null
  supervisorctl update >/dev/null
  NEED_API_RESTART=1
fi

if [[ $NEED_API_RESTART -eq 1 ]]; then
  info "Restarting birdie-api"
  supervisorctl restart birdie-api >/dev/null
  ok "API restarted"
fi

ok "Birdie updated to $(git rev-parse --short HEAD)"
