import asyncio
from collections.abc import Generator
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from app.db.session import build_engine, get_db
from app.intake_relay import create_relay_app
from app.models.intake import CustomerFormSubmission
from app.services.intake import claim_submission


@pytest.fixture
def relay_client(
    migrated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[TestClient, None, None]:
    monkeypatch.setenv("CATCARE_INTAKE_RELAY_SERVER", "1")
    monkeypatch.setenv("CATCARE_INTAKE_RELAY_KEY", "relay-test-secret")
    monkeypatch.setenv("CATCARE_PUBLIC_FILL_ORIGIN", "https://fill.example.test")
    monkeypatch.setenv(
        "CATCARE_RELAY_ALLOWED_HOSTS",
        "testserver,fill.example.test",
    )
    engine = build_engine(migrated_database_url)
    testing_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db() -> Generator[Session, None, None]:
        with testing_session() as session:
            yield session

    relay = create_relay_app()
    relay.state.testing_session = testing_session
    relay.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(relay) as client:
            yield client
    finally:
        relay.dependency_overrides.clear()
        engine.dispose()


def _auth() -> dict[str, str]:
    return {"Authorization": "Bearer relay-test-secret"}


def test_relay_cors_auth_body_limit_and_route_isolation(
    relay_client: TestClient,
) -> None:
    assert relay_client.get("/api/admin/intake/tokens").status_code == 401
    token = relay_client.post(
        "/api/admin/intake/tokens",
        headers=_auth(),
        json={"expires_in_days": 14},
    )
    assert token.status_code == 201
    raw_token = token.json()["fill_path"].rsplit("/", 1)[-1]

    public = relay_client.get(
        f"/api/fill/{raw_token}",
        headers={"Origin": "https://fill.example.test"},
    )
    assert public.status_code == 200
    assert public.headers["access-control-allow-origin"] == "https://fill.example.test"
    assert public.headers["cache-control"] == "no-store"

    disallowed = relay_client.get(
        f"/api/fill/{raw_token}",
        headers={"Origin": "https://evil.example.test"},
    )
    assert "access-control-allow-origin" not in disallowed.headers

    oversized = relay_client.put(
        f"/api/fill/{raw_token}",
        headers={"Content-Length": str(256 * 1024 + 1)},
        content=b"{}",
    )
    assert oversized.status_code == 413
    assert oversized.headers["cache-control"] == "no-store"

    dishonest_length = relay_client.put(
        f"/api/fill/{raw_token}",
        headers={"Content-Length": "1"},
        content=b"x" * (256 * 1024 + 1),
    )
    assert dishonest_length.status_code == 413

    assert relay_client.post(
        "/api/admin/intake/submissions/1/archive-customer",
        headers=_auth(),
        json={
            "expected_revision": "a" * 64,
            "idempotency_key": "forbidden-cloud-archive-0001",
        },
    ).status_code == 404
    for private_path in (
        "/admin",
        "/mobile",
        "/api/admin/customers",
        "/api/admin/orders",
        "/api/orders",
        "/docs",
        "/openapi.json",
    ):
        assert relay_client.get(private_path).status_code == 404


def test_relay_stops_streaming_unknown_length_body_at_limit(
    relay_client: TestClient,
) -> None:
    yielded_chunks: list[int] = []

    async def oversized_chunks():
        for index in range(4):
            yielded_chunks.append(index)
            yield b"x" * (100 * 1024)

    async def request() -> httpx.Response:
        transport = httpx.ASGITransport(app=relay_client.app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            return await client.put(
                "/api/fill/streamed-test-token",
                content=oversized_chunks(),
            )

    response = asyncio.run(request())

    assert response.status_code == 413
    assert response.headers["cache-control"] == "no-store"
    assert yielded_chunks == [0, 1, 2]


def test_relay_rate_limit_applies_to_token(
    relay_client: TestClient,
) -> None:
    token = relay_client.post(
        "/api/admin/intake/tokens",
        headers=_auth(),
        json={"expires_in_days": 14},
    ).json()
    raw_token = token["fill_path"].rsplit("/", 1)[-1]

    responses = [relay_client.get(f"/api/fill/{raw_token}") for _ in range(61)]
    assert all(response.status_code == 200 for response in responses[:60])
    assert responses[-1].status_code == 429
    assert responses[-1].headers["retry-after"] == "60"
    assert responses[-1].headers["cache-control"] == "no-store"


def test_relay_claim_complete_and_redaction_keep_only_receipt(
    relay_client: TestClient,
) -> None:
    token = relay_client.post(
        "/api/admin/intake/tokens",
        headers=_auth(),
        json={"expires_in_days": 14},
    ).json()
    raw_token = token["fill_path"].rsplit("/", 1)[-1]
    payload = {
        "customer": {"name": "云端测试客户", "phone": "TEST-CONTACT"},
        "cats": [],
        "service": {},
    }
    submitted = relay_client.post(
        f"/api/fill/{raw_token}/submit",
        json={
            "expected_revision": token["revision"],
            "idempotency_key": "relay-submit-idempotency-0001",
            "payload": payload,
        },
    )
    assert submitted.status_code == 200
    summary = relay_client.get(
        "/api/admin/intake/submissions",
        headers=_auth(),
    ).json()["items"][0]
    claim = relay_client.post(
        f"/api/admin/intake/submissions/{summary['id']}/claim",
        headers=_auth(),
        json={
            "expected_revision": summary["revision"],
            "idempotency_key": "relay-decision-idempotency-0001",
            "decision_mode": "customer",
        },
    )
    assert claim.status_code == 200

    session_factory = relay_client.app.state.testing_session
    with session_factory() as first_session, session_factory() as stale_session:
        first_submission = first_session.get(CustomerFormSubmission, summary["id"])
        stale_submission = stale_session.get(CustomerFormSubmission, summary["id"])
        assert first_submission is not None and stale_submission is not None
        reclaimed = claim_submission(
            first_session,
            first_submission,
            expected_revision=claim.json()["revision"],
            idempotency_key="relay-decision-idempotency-0001",
            decision_mode="customer",
        )
        assert reclaimed.claim_token is not None
        first_session.commit()
        with pytest.raises(HTTPException) as conflict:
            claim_submission(
                stale_session,
                stale_submission,
                expected_revision=claim.json()["revision"],
                idempotency_key="relay-decision-idempotency-0001",
                decision_mode="customer",
            )
        assert conflict.value.status_code == 409

    complete = relay_client.post(
        f"/api/admin/intake/submissions/{summary['id']}/complete",
        headers=_auth(),
        json={
            "claim_token": reclaimed.claim_token,
            "idempotency_key": "relay-decision-idempotency-0001",
            "decision_mode": "customer",
            "customer_id": 987654,
            "order_id": None,
        },
    )
    assert complete.status_code == 200
    assert complete.json()["customer_id"] == 987654
    assert complete.json()["status"] == "archived_customer"

    detail = relay_client.get(
        f"/api/admin/intake/submissions/{summary['id']}",
        headers=_auth(),
    ).json()
    assert detail["payload"]["customer"]["phone"] == "TEST-CONTACT"
    assert detail["purge_after"] is not None
    assert detail["converted_customer_id"] == 987654
    assert [event["event_type"] for event in detail["audit_events"]] == [
        "submitted",
        "processing_claimed",
        "processing_reclaimed",
        "completed_customer",
    ]
    assert "TEST-CONTACT" not in str(detail["audit_events"])

    with relay_client.app.state.testing_session.begin() as session:
        stored = session.get(CustomerFormSubmission, summary["id"])
        assert stored is not None
        stored.purge_after = datetime.now(timezone.utc) - timedelta(seconds=1)

    redacted = relay_client.post(
        "/api/admin/intake/maintenance/redact",
        headers=_auth(),
    )
    assert redacted.status_code == 200
    assert redacted.json() == {"redacted_count": 1}
    minimal = relay_client.get(
        f"/api/admin/intake/submissions/{summary['id']}",
        headers=_auth(),
    ).json()
    assert minimal["status"] == "redacted"
    assert minimal["payload"]["customer"]["phone"] is None
    assert minimal["review_payload"] is None
    assert minimal["converted_customer_id"] == 987654
    assert minimal["audit_events"][-1]["event_type"] == "redacted"
