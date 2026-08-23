from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from app.db.session import build_engine, get_db
from app.main import app


TRUSTED_ORIGIN = "http://localhost:5180"


@pytest.fixture
def local_client(migrated_database_url: str) -> Generator[TestClient, None, None]:
    engine = build_engine(migrated_database_url)
    testing_session = sessionmaker(
        bind=engine,
        autoflush=False,
        expire_on_commit=False,
    )

    def override_get_db() -> Generator[Session, None, None]:
        with testing_session() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def test_admin_and_mobile_routes_do_not_require_login(local_client: TestClient) -> None:
    assert local_client.get("/api/admin/customers").status_code == 200
    assert local_client.get("/api/mobile/today").status_code == 200
    assert local_client.get("/api/auth/session").status_code == 404
    assert local_client.post("/api/auth/login", json={}).status_code == 404
    assert local_client.post("/api/auth/logout").status_code == 404


def test_local_write_still_rejects_untrusted_browser_origin(
    local_client: TestClient,
) -> None:
    rejected = local_client.post(
        "/api/admin/customers",
        headers={"Origin": "https://untrusted.example"},
        json={"name": "不会写入的虚构客户"},
    )
    assert rejected.status_code == 403
    assert rejected.json()["detail"] == "请求来源不受信任"

    cross_site = local_client.post(
        "/api/admin/customers",
        headers={"Sec-Fetch-Site": "cross-site"},
        json={"name": "不会写入的虚构客户"},
    )
    assert cross_site.status_code == 403


def test_trusted_local_origin_can_write_without_a_session(
    local_client: TestClient,
) -> None:
    created = local_client.post(
        "/api/admin/customers",
        headers={"Origin": TRUSTED_ORIGIN},
        json={"name": "本地免登录测试客户"},
    )
    assert created.status_code == 201


def test_untrusted_host_is_rejected() -> None:
    with TestClient(app, base_url="http://untrusted.example") as client:
        assert client.get("/api/health").status_code == 400
