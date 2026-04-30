"""
Alembic env — sync runner.

We deliberately DO NOT call fileConfig() unconditionally; the previous repo
crashed at install time with `KeyError: 'formatters'` whenever the alembic.ini
was missing logging sections.
"""
from __future__ import annotations

import os
import sys
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool
from dotenv import load_dotenv

# Make backend/ importable so we can grab models.Base
HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.abspath(os.path.join(HERE, ".."))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

# Load .env (from backend/.env if running via supervisor / install.sh)
load_dotenv(os.path.join(BACKEND, ".env"))

# Alembic config object
config = context.config

# Logging — only if the ini actually defined a [formatters] section.
if config.config_file_name is not None:
    try:
        if config.get_section("formatters"):
            fileConfig(config.config_file_name)
    except Exception:
        pass


def _sync_url() -> str:
    """Resolve sync DB URL from env (Alembic's runtime is sync)."""
    url = os.environ.get("SYNC_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError(
            "DATABASE_URL not set — copy backend/.env.example to backend/.env"
        )
    return url.replace("+asyncpg", "+psycopg2")


config.set_main_option("sqlalchemy.url", _sync_url())

# Import models so Alembic autogenerate sees them
from models import Base  # noqa: E402

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
