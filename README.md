# Birdie

Self-hosted golf GPS, scorecard, and shot-tracking app for Proxmox LXC.

## What this repo contains

- `create.sh` — run on the Proxmox host to create the LXC with tteck-style prompts.
- `install.sh` — run inside the LXC to install Birdie.
- `update.sh` — run inside the LXC to safely update from GitHub.
- `backend/` — FastAPI app, models, routes, and Alembic migrations.
- `frontend/` — React + Vite app.
- `deploy/` — nginx and supervisor configs.

## Rules

- GitHub is the only source of truth.
- Do not edit files directly in the container.
- Updates use `git fetch` + `git reset --hard origin/main`, not `git pull`.
- Birdie serves locally on port `8080` by default.
- Cloudflare or other HTTPS/tunnel setup is optional and handled separately.

## Quick start

### 1) Create the repo

Create a new GitHub repo, then upload the contents of this folder as the initial commit.

### 2) Run from the Proxmox host

After replacing the repo URL inside `create.sh` and `install.sh`, run:

```bash
bash create.sh
```

### 3) Open Birdie

- App: `http://<LXC-IP>:8080`
- API docs: `http://<LXC-IP>:8080/api/docs`

## Update flow

SSH or shell into the container, then run:

```bash
/opt/birdie/update.sh
```
