"""initial schema

Revision ID: 001
Revises:
Create Date: 2026-04-29
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Idempotent schema creation. Uses raw SQL with `IF NOT EXISTS` so re-runs
    against a partially-migrated database don't blow up — that's the failure
    mode that previously locked installs into a "must wipe DB" loop.
    """
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis;")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id              SERIAL PRIMARY KEY,
            email           VARCHAR(255) NOT NULL UNIQUE,
            full_name       VARCHAR(120) NOT NULL DEFAULT '',
            hashed_password VARCHAR(255) NOT NULL,
            is_admin        BOOLEAN NOT NULL DEFAULT FALSE,
            is_active       BOOLEAN NOT NULL DEFAULT TRUE,
            handicap_index  DOUBLE PRECISION,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS courses (
            id            SERIAL PRIMARY KEY,
            osm_id        VARCHAR(64) UNIQUE,
            name          VARCHAR(255) NOT NULL,
            city          VARCHAR(120),
            country       VARCHAR(120),
            location      geometry(POINT, 4326),
            total_holes   INTEGER NOT NULL DEFAULT 18,
            par           INTEGER NOT NULL DEFAULT 72,
            course_rating DOUBLE PRECISION,
            slope_rating  DOUBLE PRECISION,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_courses_location "
        "ON courses USING gist (location);"
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_courses_osm_id ON courses (osm_id);")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS holes (
            id              SERIAL PRIMARY KEY,
            course_id       INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
            number          INTEGER NOT NULL,
            par             INTEGER NOT NULL DEFAULT 4,
            handicap_index  INTEGER,
            distance_yards  INTEGER,
            tee_location    geometry(POINT, 4326),
            pin_location    geometry(POINT, 4326),
            hole_line       geometry(LINESTRING, 4326),
            fairway_polygon geometry(POLYGON, 4326),
            green_polygon   geometry(POLYGON, 4326)
        );
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_holes_course ON holes (course_id);")
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_holes_pin "
        "ON holes USING gist (pin_location);"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS rounds (
            id                    SERIAL PRIMARY KEY,
            user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            course_id             INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
            started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            finished_at           TIMESTAMPTZ,
            is_complete           BOOLEAN NOT NULL DEFAULT FALSE,
            tee_colour            VARCHAR(20) NOT NULL DEFAULT 'white',
            handicap_differential DOUBLE PRECISION,
            notes                 TEXT
        );
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_rounds_user ON rounds (user_id);")
    op.execute("CREATE INDEX IF NOT EXISTS idx_rounds_course ON rounds (course_id);")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS scores (
            id                  SERIAL PRIMARY KEY,
            round_id            INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
            hole_id             INTEGER NOT NULL REFERENCES holes(id) ON DELETE CASCADE,
            strokes             INTEGER NOT NULL,
            putts               INTEGER,
            fairway_hit         BOOLEAN,
            green_in_regulation BOOLEAN,
            penalty_strokes     INTEGER NOT NULL DEFAULT 0,
            notes               TEXT
        );
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_scores_round ON scores (round_id);")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS shots (
            id               SERIAL PRIMARY KEY,
            round_id         INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
            hole_id          INTEGER NOT NULL REFERENCES holes(id) ON DELETE CASCADE,
            shot_number      INTEGER NOT NULL,
            location         geometry(POINT, 4326) NOT NULL,
            landing_location geometry(POINT, 4326),
            club             VARCHAR(20),
            shot_type        VARCHAR(20),
            distance_yards   DOUBLE PRECISION,
            is_penalty       BOOLEAN NOT NULL DEFAULT FALSE,
            recorded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_shots_round ON shots (round_id);")
    op.execute("CREATE INDEX IF NOT EXISTS idx_shots_hole ON shots (hole_id);")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS shots CASCADE;")
    op.execute("DROP TABLE IF EXISTS scores CASCADE;")
    op.execute("DROP TABLE IF EXISTS rounds CASCADE;")
    op.execute("DROP TABLE IF EXISTS holes CASCADE;")
    op.execute("DROP TABLE IF EXISTS courses CASCADE;")
    op.execute("DROP TABLE IF EXISTS users CASCADE;")
