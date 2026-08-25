from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

import app.main as main_module
from app.db.session import build_engine
from app.main import app


client = TestClient(app)


def test_health_check_reports_ready() -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "catcare-hub-api",
    }


@pytest.fixture
def ready_client(
    migrated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[tuple[TestClient, Engine], None, None]:
    database_engine = build_engine(migrated_database_url)
    monkeypatch.setattr(main_module, "engine", database_engine)
    try:
        with TestClient(app) as test_client:
            yield test_client, database_engine
    finally:
        database_engine.dispose()


def test_ready_check_reports_current_database_revision(
    ready_client: tuple[TestClient, Engine],
) -> None:
    test_client, _ = ready_client

    response = test_client.get("/api/ready")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "service": "catcare-hub-api",
        "database": "ready",
        "schema_revision": "0010_payment_void_audit",
    }


def test_ready_check_rejects_outdated_database_without_details(
    ready_client: tuple[TestClient, Engine],
) -> None:
    test_client, database_engine = ready_client
    with database_engine.begin() as connection:
        connection.execute(
            text("UPDATE alembic_version SET version_num = 'outdated_revision'")
        )

    response = test_client.get("/api/ready")

    assert response.status_code == 503
    assert response.json() == {
        "status": "not_ready",
        "service": "catcare-hub-api",
        "reason": "schema_outdated",
        "message": "数据库版本与当前程序不一致，请运行 migrate.bat。",
    }


def test_ready_check_sanitizes_an_unreachable_database(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    blocked_path = tmp_path / "database-is-a-directory"
    blocked_path.mkdir()
    unavailable_engine = build_engine(f"sqlite:///{blocked_path.as_posix()}")
    monkeypatch.setattr(main_module, "engine", unavailable_engine)
    try:
        response = client.get("/api/ready")
    finally:
        unavailable_engine.dispose()

    assert response.status_code == 503
    assert response.json() == {
        "status": "not_ready",
        "service": "catcare-hub-api",
        "reason": "database_unavailable",
        "message": "数据库暂时不可用，请检查本机数据库文件。",
    }
