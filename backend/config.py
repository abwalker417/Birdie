from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    database_url: str
    jwt_secret: str
    app_env: str = "development"
    cors_origins: str = "http://localhost:8080"
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
