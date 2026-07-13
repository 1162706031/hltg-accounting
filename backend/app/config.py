from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    app_name: str = "HLTG Accounting API"
    api_prefix: str = "/api/v1"
    debug: bool = Field(default=False, validation_alias="APP_DEBUG")
    backend_host: str = Field(default="0.0.0.0", validation_alias="BACKEND_HOST")
    backend_port: int = Field(default=8000, validation_alias="BACKEND_PORT")

    db_host: str = Field(default="127.0.0.1", validation_alias="DB_HOST")
    db_port: int = Field(default=3306, validation_alias="DB_PORT")
    db_user: str = Field(default="root", validation_alias="DB_USER")
    db_password: str = Field(default="", validation_alias="DB_PASSWORD")
    db_name: str = Field(default="hltg_accounting", validation_alias="DB_NAME")

    jwt_secret_key: str = Field(default="change-me-in-production", validation_alias="JWT_SECRET_KEY")
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 120
    refresh_token_minutes: int = 60 * 24 * 7

    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:5173"]

    # Optional external AI agent used by the dashboard's intelligent Q&A drawer.
    # Keep credentials on the backend so they are never exposed to browsers.
    ai_agent_url: str | None = Field(default=None, validation_alias="AI_AGENT_URL")
    ai_agent_api_key: str | None = Field(default=None, validation_alias="AI_AGENT_API_KEY")
    ai_agent_role: str | None = Field(default=None, validation_alias="AI_AGENT_ROLE")
    ai_agent_provider: str = Field(default="AgentScope 智能体", validation_alias="AI_AGENT_PROVIDER")
    ai_agent_timeout_seconds: int = Field(default=120, validation_alias="AI_AGENT_TIMEOUT_SECONDS")

    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def database_url(self) -> str:
        return (
            f"mysql+aiomysql://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}?charset=utf8mb4"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
