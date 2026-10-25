"""Application settings, read from environment / .env."""
import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


@dataclass(frozen=True)
class Settings:
    app_password: str = field(default_factory=lambda: os.getenv("APP_PASSWORD", ""))
    secret_key: str = field(default_factory=lambda: os.getenv("SECRET_KEY", ""))
    anthropic_api_key: str = field(default_factory=lambda: os.getenv("ANTHROPIC_API_KEY", ""))
    anthropic_model: str = field(default_factory=lambda: os.getenv("ANTHROPIC_MODEL", "claude-opus-5-5"))
    anthropic_effort: str = field(default_factory=lambda: os.getenv("ANTHROPIC_EFFORT", "high"))
    anthropic_fallbacks: str = field(default_factory=lambda: os.getenv("ANTHROPIC_FALLBACKS", "default"))
    data_dir: Path = field(
        default_factory=lambda: Path(os.getenv("SEHSCHULE_DATA_DIR", str(BASE_DIR / "data")))
    )

    @property
    def images_dir(self) -> Path:
        return self.data_dir / "images"

    @property
    def thumbs_dir(self) -> Path:
        return self.data_dir / "thumbs"

    @property
    def db_url(self) -> str:
        return os.getenv("SEHSCHULE_DB_URL", f"sqlite:///{self.data_dir / 'sehschule.db'}")


settings = Settings()
PROMPTS_DIR = BASE_DIR / "prompts"
SEED_DIR = BASE_DIR / "seed"
