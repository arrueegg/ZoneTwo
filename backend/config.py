from pathlib import Path
from pydantic_settings import BaseSettings

# .env lives one level up from this file (project root)
_ENV_FILE = Path(__file__).parent.parent / ".env"


class Settings(BaseSettings):
    # Strava
    strava_client_id: str = ""
    strava_client_secret: str = ""
    strava_redirect_uri: str = "http://localhost:8000/auth/strava/callback"

    # Garmin
    garmin_client_id: str = ""
    garmin_client_secret: str = ""
    garmin_redirect_uri: str = "http://localhost:8000/auth/garmin/callback"

    # Database
    database_url: str = "sqlite+aiosqlite:///./training_app.db"

    # Anthropic
    anthropic_api_key: str = ""

    # App
    secret_key: str = "change-me"
    frontend_url: str = "http://localhost:3000"

    model_config = {"env_file": str(_ENV_FILE), "case_sensitive": False}


settings = Settings()
