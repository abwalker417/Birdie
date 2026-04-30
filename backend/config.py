"""
Centralised app config — loaded from .env via pydantic-settings.

`extra='ignore'` is critical: previous installs wrote SYNC_DATABASE_URL into
.env which broke startup with "Extra inputs are not permitted". We tolerate
unknown keys instead of forbidding them.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Async DB URL used by FastAPI (asyncpg)
    database_url: str = "postgresql+asyncpg://birdie:birdie@localhost:5432/birdie"

    # JWT
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 30  # 30 days

    # Misc
    app_env: str = "production"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


settings = Settings()


def sync_database_url() -> str:
    """
    Convert the async URL into a sync (psycopg2) URL for Alembic.
    Alembic needs a synchronous driver because its migration runtime is sync.
    """
    return settings.database_url.replace("+asyncpg", "+psycopg2")
