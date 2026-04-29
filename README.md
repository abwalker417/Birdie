# Birdie

Complete repo package for a self-hosted Birdie install on Debian 12 / Proxmox LXC.

## Fixed in this package
- Replaced broken `install.sh` with a complete installer that writes `.env`, installs backend/frontend deps, configures supervisor and nginx, and creates `update.sh`.
- Added a proper `update.sh` for GitHub-driven updates instead of patching in the container.
- Replaced the malformed Alembic `env.py` with a valid version.
- Replaced the incomplete initial migration with a usable baseline schema.
- Replaced the placeholder `models.py` with SQLAlchemy models.
- Kept the frontend PWA config but adjusted caching behavior in nginx to reduce stale app issues.

## Usage
Fresh install:
```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/abwalker417/birdie/main/install.sh)"
```

Update after pushing to GitHub:
```bash
/opt/birdie/app/update.sh
```
