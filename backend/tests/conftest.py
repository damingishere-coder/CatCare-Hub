import os
import sys
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Tests must never load the repository's real .env or fall back to the business DB.
os.environ["PYTHON_DOTENV_DISABLED"] = "1"
os.environ.setdefault("CATCARE_DATABASE_URL", "sqlite:///:memory:")

from app.main import app  # noqa: E402
from app.services.auth import require_admin, require_mobile  # noqa: E402


def _bypass_admin() -> None:
    return None


def _bypass_mobile() -> None:
    return None


@pytest.fixture(autouse=True)
def preserve_pre_p12_business_test_scope():
    """Keep existing business tests focused; P12 tests remove these overrides."""

    app.dependency_overrides[require_admin] = _bypass_admin
    app.dependency_overrides[require_mobile] = _bypass_mobile
    try:
        yield
    finally:
        app.dependency_overrides.pop(require_admin, None)
        app.dependency_overrides.pop(require_mobile, None)


@pytest.fixture
def real_auth_dependencies():
    app.dependency_overrides.pop(require_admin, None)
    app.dependency_overrides.pop(require_mobile, None)
    try:
        yield
    finally:
        app.dependency_overrides[require_admin] = _bypass_admin
        app.dependency_overrides[require_mobile] = _bypass_mobile


def alembic_config(database_url: str) -> Config:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", database_url)
    return config


@pytest.fixture
def migrated_database_url(tmp_path: Path) -> str:
    database_path = tmp_path / "catcare-test.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    command.upgrade(alembic_config(database_url), "head")
    return database_url
