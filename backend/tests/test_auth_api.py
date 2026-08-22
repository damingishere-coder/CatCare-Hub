from collections.abc import Generator
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.db.session import build_engine, get_db
from app.main import app
from app.models.auth import AccessSession
from app.models.intake import CustomerFormToken
from app.services.auth import (
    SESSION_COOKIE_NAME,
    configured_password_hash,
    login_rate_limiter,
)
from app.services.credentials import hash_access_code, token_digest


ADMIN_CODE = "P12-admin-test-code"
MOBILE_CODE = "P12-mobile-test-code"
TRUSTED_ORIGIN = "http://localhost:5180"


@dataclass
class AuthApiContext:
    client: TestClient
    session_factory: sessionmaker[Session]


@pytest.fixture
def auth_api_context(
    migrated_database_url: str,
    real_auth_dependencies,
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[AuthApiContext, None, None]:
    engine = build_engine(migrated_database_url)
    factory = sessionmaker(bind=engine, expire_on_commit=False)

    def override_get_db() -> Generator[Session, None, None]:
        with factory() as session:
            yield session

    monkeypatch.setenv(
        "CATCARE_ADMIN_PASSWORD_HASH",
        hash_access_code(ADMIN_CODE, iterations=300_000),
    )
    monkeypatch.setenv(
        "CATCARE_MOBILE_PASSWORD_HASH",
        hash_access_code(MOBILE_CODE, iterations=300_000),
    )
    monkeypatch.setenv("CATCARE_SESSION_HOURS", "12")
    monkeypatch.setenv("CATCARE_COOKIE_SECURE", "false")
    monkeypatch.setenv("CATCARE_TRUSTED_ORIGINS", TRUSTED_ORIGIN)
    login_rate_limiter.reset()
    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            yield AuthApiContext(client=client, session_factory=factory)
    finally:
        app.dependency_overrides.pop(get_db, None)
        login_rate_limiter.reset()
        engine.dispose()


def login(client: TestClient, role: str, access_code: str):
    return client.post(
        "/api/auth/login",
        headers={"Origin": TRUSTED_ORIGIN},
        json={"role": role, "access_code": access_code},
    )


def test_anonymous_boundaries_health_and_fill_remain_public(
    auth_api_context: AuthApiContext,
) -> None:
    client = auth_api_context.client
    raw_token = "P12_" + "x" * 40
    with auth_api_context.session_factory.begin() as session:
        session.add(
            CustomerFormToken(
                token_hash=token_digest(raw_token),
                expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            )
        )

    assert client.get("/api/health").status_code == 200
    admin = client.get("/api/admin/dashboard", params={"date": "2035-10-06"})
    mobile = client.get("/api/mobile/today")
    public_fill = client.get(f"/api/fill/{raw_token}")
    assert admin.status_code == 401
    assert mobile.status_code == 401
    assert public_fill.status_code == 200
    assert admin.headers["cache-control"] == "no-store"
    assert public_fill.headers["referrer-policy"] == "no-referrer"
    assert raw_token not in public_fill.text


def test_admin_session_cookie_rotation_logout_and_hash_only_storage(
    auth_api_context: AuthApiContext,
) -> None:
    client = auth_api_context.client
    response = login(client, "admin", ADMIN_CODE)
    assert response.status_code == 200
    assert response.json()["role"] == "admin"
    set_cookie = response.headers["set-cookie"].lower()
    assert "httponly" in set_cookie
    assert "samesite=strict" in set_cookie
    assert "path=/" in set_cookie
    assert "max-age=" in set_cookie
    assert "secure" not in set_cookie

    raw_session = client.cookies.get(SESSION_COOKIE_NAME)
    assert raw_session
    with auth_api_context.session_factory() as session:
        stored = session.scalar(select(AccessSession))
        assert stored is not None
        assert stored.token_hash == token_digest(raw_session)
        assert raw_session != stored.token_hash

    assert client.get("/api/auth/session").json()["role"] == "admin"
    assert client.get("/api/admin/dashboard", params={"date": "2035-10-06"}).status_code == 200
    assert client.get("/api/mobile/today").status_code == 200

    second = login(client, "admin", ADMIN_CODE)
    assert second.status_code == 200
    assert client.cookies.get(SESSION_COOKIE_NAME) != raw_session
    with auth_api_context.session_factory() as session:
        assert session.scalar(select(func.count(AccessSession.id))) == 1

    logout = client.post("/api/auth/logout", headers={"Origin": TRUSTED_ORIGIN})
    assert logout.status_code == 204
    assert client.get("/api/auth/session").status_code == 401
    with auth_api_context.session_factory() as session:
        assert session.scalar(select(func.count(AccessSession.id))) == 0


def test_mobile_role_cannot_access_admin_and_inputs_reject_extras(
    auth_api_context: AuthApiContext,
) -> None:
    client = auth_api_context.client
    assert login(client, "mobile", MOBILE_CODE).status_code == 200
    assert client.get("/api/mobile/today").status_code == 200
    forbidden = client.get("/api/admin/customers")
    assert forbidden.status_code == 403
    assert "后台权限" in forbidden.json()["detail"]

    client.post("/api/auth/logout", headers={"Origin": TRUSTED_ORIGIN})
    assert login(client, "admin", ADMIN_CODE).status_code == 200
    cross_origin_write = client.post(
        "/api/admin/customers",
        headers={"Origin": "https://evil.example"},
        json={"name": "不应写入的虚构客户"},
    )
    assert cross_origin_write.status_code == 403
    extra = client.post(
        "/api/admin/customers",
        headers={"Origin": TRUSTED_ORIGIN},
        json={"name": "P12 虚构客户", "unexpected": "forbidden"},
    )
    assert extra.status_code == 422


def test_origin_host_configuration_and_login_rate_limit(
    auth_api_context: AuthApiContext,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = auth_api_context.client
    cross_site = client.post(
        "/api/auth/login",
        headers={"Origin": "https://evil.example", "Sec-Fetch-Site": "cross-site"},
        json={"role": "admin", "access_code": ADMIN_CODE},
    )
    assert cross_site.status_code == 403
    assert client.get("/api/health", headers={"Host": "evil.example"}).status_code == 400
    short_code = login(client, "admin", "too-short")
    assert short_code.status_code == 422
    assert "too-short" not in short_code.text

    for _ in range(5):
        failed = login(client, "admin", "wrong-code-12345")
        assert failed.status_code == 401
        assert "hash" not in failed.text.lower()
    limited = login(client, "admin", ADMIN_CODE)
    assert limited.status_code == 429
    assert int(limited.headers["retry-after"]) > 0

    login_rate_limiter.reset()
    monkeypatch.setenv("CATCARE_ADMIN_PASSWORD_HASH", "invalid-format")
    unconfigured = login(client, "admin", ADMIN_CODE)
    assert unconfigured.status_code == 503
    assert "setup.bat" in unconfigured.json()["detail"]


def test_expired_session_is_deleted_and_cannot_be_reused(
    auth_api_context: AuthApiContext,
) -> None:
    raw_token = "expired-session-token-value"
    with auth_api_context.session_factory.begin() as session:
        session.add(
            AccessSession(
                token_hash=token_digest(raw_token),
                role="admin",
                credential_fingerprint=token_digest(
                    configured_password_hash("admin") or ""
                ),
                expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
            )
        )
    response = auth_api_context.client.get(
        "/api/auth/session",
        headers={"Cookie": f"{SESSION_COOKIE_NAME}={raw_token}"},
    )
    assert response.status_code == 401
    with auth_api_context.session_factory() as session:
        assert session.scalar(select(func.count(AccessSession.id))) == 0


def test_access_code_change_invalidates_existing_role_sessions(
    auth_api_context: AuthApiContext,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = auth_api_context.client
    assert login(client, "admin", ADMIN_CODE).status_code == 200
    monkeypatch.setenv(
        "CATCARE_ADMIN_PASSWORD_HASH",
        hash_access_code("new-admin-test-code", iterations=300_000),
    )
    assert client.get("/api/auth/session").status_code == 401
    with auth_api_context.session_factory() as session:
        assert session.scalar(select(func.count(AccessSession.id))) == 0
