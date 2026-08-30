import os
import re
import sys
from uuid import uuid4
from pathlib import Path

import pytest
import fastapi.testclient as fastapi_testclient
from starlette.testclient import TestClient as StarletteTestClient
from alembic import command
from alembic.config import Config

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Tests must never load the repository's real .env or fall back to the business DB.
os.environ["PYTHON_DOTENV_DISABLED"] = "1"
os.environ.setdefault("CATCARE_DATABASE_URL", "sqlite:///:memory:")

from app.main import app  # noqa: E402


class ContractTestClient(StarletteTestClient):
    """Supply current write contracts for legacy workflow tests.

    Focused contract tests can set ``X-Test-Skip-Order-Guards`` to verify that
    production endpoints reject a missing header.
    """

    def request(self, method: str, url, **kwargs):  # type: ignore[no-untyped-def]
        headers = dict(kwargs.pop("headers", {}) or {})
        skip_guards = headers.pop("X-Test-Skip-Order-Guards", None) is not None
        path = str(url).split("?", 1)[0]
        normalized_method = method.upper()
        if (
            not skip_guards
            and normalized_method == "POST"
            and path.rstrip("/") == "/api/admin/orders"
            and "Idempotency-Key" not in headers
        ):
            headers["Idempotency-Key"] = str(uuid4())

        guarded = re.fullmatch(
            r"/api/admin/orders/(?P<order_id>\d+)(?:/status|/geocode)?/?",
            path,
        )
        guard_methods = {"PATCH", "PUT", "DELETE"}
        if path.endswith("/geocode"):
            guard_methods.add("POST")
        if (
            not skip_guards
            and guarded is not None
            and normalized_method in guard_methods
            and "If-Match" not in headers
        ):
            detail = super().request(
                "GET",
                f"/api/admin/orders/{guarded.group('order_id')}",
            )
            if detail.status_code == 200:
                headers["If-Match"] = detail.json()["write_revision"]

        return super().request(method, url, headers=headers, **kwargs)


fastapi_testclient.TestClient = ContractTestClient


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
