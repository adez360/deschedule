from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://schedule_user:changeme@localhost:5432/schedule_db"
    redis_url: str = "redis://localhost:6379/0"
    secret_key: str = "dev-secret-key-change-in-production"
    access_token_expire_minutes: int = 1440  # 24h for dev; shorten + add refresh in prod
    refresh_token_expire_days: int = 7
    allowed_origins: list[str] = ["http://localhost:3000", "http://localhost:80"]


settings = Settings()
