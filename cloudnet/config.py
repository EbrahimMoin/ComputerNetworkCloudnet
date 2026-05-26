from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
UPLOADS_DIR = STATIC_DIR / "uploads"
INDEX_FILE = BASE_DIR / "index.html"
MIGRATIONS_DIR = BASE_DIR / "migrations"
DEFAULT_DB_PATH = BASE_DIR / "cloudnet.sqlite3"


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw in (None, ""):
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_str(name: str, default: str = "") -> str:
    value = os.getenv(name, default)
    return value if value is not None else default


def _env_path(name: str, default: Path) -> Path:
    raw = os.getenv(name)
    if raw in (None, ""):
        return default
    return Path(raw).expanduser()


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw in (None, ""):
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    db_host: str = ""
    db_port: int = 5432
    db_name: str = ""
    db_user: str = ""
    db_password: str = ""
    database_path: Path = DEFAULT_DB_PATH
    uploads_dir: Path = UPLOADS_DIR
    secret_key: str = ""
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7
    app_title: str = "CloudNet"
    run_migrations_on_startup: bool = True

    @property
    def db_configured(self) -> bool:
        return bool(self.db_host and self.db_name and self.db_user)

    @property
    def db_backend(self) -> str:
        return "postgres" if self.db_configured else "sqlite"




@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings(
        db_host=_env_str("DB_HOST"),
        db_port=_env_int("DB_PORT", 5432),
        db_name=_env_str("DB_NAME"),
        db_user=_env_str("DB_USER"),
        db_password=_env_str("DB_PASS"),
        database_path=_env_path("DB_PATH", DEFAULT_DB_PATH),
        uploads_dir=_env_path("UPLOADS_DIR", UPLOADS_DIR),
        secret_key=_env_str("SECRET_KEY"),
        algorithm=_env_str("ALGORITHM", "HS256"),
        access_token_expire_minutes=_env_int(
            "ACCESS_TOKEN_EXPIRE_MINUTES", 60 * 24 * 7),
        run_migrations_on_startup=_env_bool("RUN_MIGRATIONS_ON_STARTUP", True),
    )
