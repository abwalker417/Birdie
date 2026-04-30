# ⛳ Birdie

A self-hosted golf GPS, scorecard, and shot-tracking app built for a Proxmox LXC. OSM-only course data, repo-as-source-of-truth deployment, no external dependencies.

## What you get

- **Accounts** with admin role support (first registered user becomes admin)
- **Course search** powered by OpenStreetMap — GPS-based or city/postcode search, radius up to 50 mi
- **Smart OSM hole parser** that handles `golf=hole` ways, `golf=tee`/`golf=green` polygons, and falls back to a placeholder layout when OSM data is incomplete
- **Admin-only hole editor** — point-and-line wizard to fix bad imports (set tee, set pin, set par/HC)
- **Active round** map with overview / current-hole focus toggle, live yardage to pin via PostGIS
- **Manual shot logging** with club selector — tap the map or use GPS, distance auto-computed
- **Scorecard** with strokes, putts, FIR, GIR
- **Round history** with hard-delete so test data doesn't pile up
- **Theme picker** — light / dark / system (matches your OS by default)
- **PWA** — installable to home screen, offline tile cache for mid-round use

## Stack

| Layer | Tech |
| --- | --- |
| Frontend | React 18 + Vite + Leaflet + vite-plugin-pwa |
| Backend | FastAPI + SQLAlchemy 2 (async) + asyncpg |
| Database | PostgreSQL 15 + PostGIS |
| Deploy | nginx :8080 + supervisor in a Debian 12 LXC |

## Install (Proxmox host one-liner)

Run this on your Proxmox host. It launches a whiptail dialog for the LXC settings, creates the container, and installs Birdie inside it.

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/abwalker417/Birdie/main/create.sh)"
```

You'll be prompted every run for: container ID, hostname, root password, CPU/RAM/disk, storage, bridge, and **DHCP or static IP (CIDR format, e.g. `192.168.68.50/24`) + gateway**. There are no remembered defaults beyond reasonable starting values, so you can't accidentally reuse stale network settings.

When it finishes, the URL is printed:

```
http://<LXC-IP>:8080
http://<LXC-IP>:8080/api/docs
```

The first user that registers becomes the admin.

## Manual install (already-created LXC)

If you've already got a Debian 12 LXC, run this inside it:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/abwalker417/Birdie/main/install.sh)"
```

## Update

> **Do not edit files inside the container.** The repo is the only source of truth — manual edits create drift that breaks future updates.

To update Birdie, push your changes to GitHub, then run from the Proxmox host:

```bash
pct exec <CTID> -- bash /opt/birdie/app/update.sh
```

`update.sh` does `git fetch origin && git reset --hard origin/main`, then only rebuilds and restarts the parts that actually changed (frontend rebuild only if frontend files changed, pip install only if `requirements.txt` changed, migrations only if a new revision was added, supervisor restart only if backend files changed).

## Logs & troubleshooting

```bash
# API status
pct exec <CTID> -- supervisorctl status birdie-api

# Live API logs
pct exec <CTID> -- tail -f /var/log/birdie-api.err.log

# Restart the API
pct exec <CTID> -- supervisorctl restart birdie-api

# Database shell
pct exec <CTID> -- su - postgres -c "psql -d birdie"
```

## Local development

```bash
# Backend
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # edit DATABASE_URL + JWT_SECRET
alembic upgrade head
uvicorn main:app --reload  # localhost:8000

# Frontend
cd frontend
npm install
npm run dev  # localhost:5173, proxies /api to :8000
```
