"""Application configuration, populated from environment variables and .env."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # --- Primary LLM provider (does the work) ---
    primary_base_url: str = "https://models.github.ai/inference"
    primary_api_key: str = ""
    primary_model: str = "openai/gpt-4o-mini"

    # --- Fallback provider (only used if primary fails) ---
    # Leave fallback_api_key empty to disable fallback entirely.
    fallback_base_url: str = "https://api.deepseek.com"
    fallback_api_key: str = ""
    fallback_model: str = "deepseek-chat"

    request_timeout_seconds: float = 45.0

    max_subagent_iterations: int = 5
    max_subquestions: int = 3

    cors_origins: list[str] = ["http://localhost:4200"]

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
