from collections.abc import Generator
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import logging

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.db.session import build_engine, get_db
from app.main import app
from app.models import Cat, Customer, CustomerFormSubmission, CustomerFormToken, Order, Task
from app.models.enums import FormSubmissionStatus, FormTokenStatus
from app.services.privacy_logging import FillTokenRedactionFilter
from app.services.credentials import token_digest


@dataclass(frozen=True)
class IntakeApiContext:
    client: TestClient
    session_factory: sessionmaker[Session]


@pytest.fixture
def intake_api_context(
    migrated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[IntakeApiContext, None, None]:
    monkeypatch.delenv("CATCARE_INTAKE_RELAY_URL", raising=False)
    monkeypatch.delenv("CATCARE_INTAKE_RELAY_SERVER", raising=False)
    engine = build_engine(migrated_database_url)
    testing_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db() -> Generator[Session, None, None]:
        with testing_session() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            yield IntakeApiContext(client=client, session_factory=testing_session)
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def complete_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "customer": {
            "name": "P10 虚构客户",
            "wechat_name": "TEST-WECHAT",
            "phone": "TEST-CONTACT",
            "address": "仅用于自动测试的虚构地址",
            "access_method": "虚构门禁方式",
            "key_status": "测试状态",
            "notes": "虚构客户备注",
        },
        "cats": [
            {
                "name": "P10 测试猫甲",
                "food": "虚构主食说明",
                "litter_type": "测试猫砂",
                "medication_required": False,
                "special_notes": "虚构服务注意事项",
            },
            {
                "name": "P10 测试猫乙",
                "medication_required": True,
                "medication_notes": "仅用于自动测试",
            },
        ],
        "service": {
            "start_date": "2031-04-01",
            "end_date": "2031-04-03",
            "visits_per_day": 2,
        },
        "notes": "P10 虚构订单备注",
    }
    payload.update(overrides)
    return payload


def create_token(client: TestClient, *, days: int = 14) -> dict:
    response = client.post(
        "/api/admin/intake/tokens",
        json={"expires_in_days": days},
    )
    assert response.status_code == 201
    return response.json()


def token_value(token: dict) -> str:
    return token["fill_path"].rsplit("/", 1)[-1]


def submit_for_review(client: TestClient) -> tuple[dict, dict]:
    token = create_token(client)
    response = client.post(
        f"/api/fill/{token_value(token)}/submit",
        json={
            "expected_revision": token["revision"],
            "idempotency_key": f"submit-test-{token['id']}-000000",
            "payload": complete_payload(),
        },
    )
    assert response.status_code == 200
    detail = max(
        client.get("/api/admin/intake/submissions").json()["items"],
        key=lambda item: item["id"],
    )
    return token, detail


def test_token_generation_public_draft_and_data_isolation(
    intake_api_context: IntakeApiContext,
) -> None:
    client = intake_api_context.client
    first = create_token(client, days=7)
    second = create_token(client, days=30)

    first_value = token_value(first)
    second_value = token_value(second)
    assert first_value != second_value
    assert len(first_value) >= 40
    assert first["status"] == "active"
    assert first["fill_path"] == f"/fill/{first_value}"
    assert len(first["revision"]) == 64

    draft = {
        "customer": {"name": "第一份虚构草稿", "phone": "TEST-FIRST"},
        "cats": [{"name": "草稿猫"}],
        "service": {},
    }
    saved = client.put(
        f"/api/fill/{first_value}",
        json={"expected_revision": first["revision"], "draft": draft},
    )
    assert saved.status_code == 200
    assert saved.json()["draft"]["customer"]["phone"] == "TEST-FIRST"
    assert "service_items" not in saved.json()["draft"]["service"]

    other = client.get(f"/api/fill/{second_value}")
    assert other.status_code == 200
    assert other.json()["draft"]["customer"]["name"] is None
    assert "TEST-FIRST" not in other.text
    assert client.get("/api/fill/not-valid").status_code == 404
    assert client.get(f"/api/fill/{'x' * 43}").status_code == 404

    listed = client.get("/api/admin/intake/tokens").json()["items"]
    assert all(item["fill_path"] is None for item in listed)
    with intake_api_context.session_factory() as session:
        stored_hashes = session.scalars(select(CustomerFormToken.token_hash)).all()
        assert first_value not in stored_hashes
        assert token_digest(first_value) in stored_hashes

    invalid = client.put(
        f"/api/fill/{first_value}",
        json={
            "expected_revision": saved.json()["revision"],
            "draft": {"customer": {"name": "x" * 101}},
        },
    )
    assert invalid.status_code == 422
    unknown_field = client.put(
        f"/api/fill/{first_value}",
        json={
            "expected_revision": saved.json()["revision"],
            "draft": {"customer": {"name": "草稿", "unexpected": "forbidden"}},
        },
    )
    assert unknown_field.status_code == 422


def test_token_status_revision_and_expiry_are_enforced(
    intake_api_context: IntakeApiContext,
) -> None:
    client = intake_api_context.client
    token = create_token(client)
    value = token_value(token)

    stale = client.patch(
        f"/api/admin/intake/tokens/{token['id']}",
        json={"status": "disabled", "expected_revision": "0" * 64},
    )
    assert stale.status_code == 409

    disabled = client.patch(
        f"/api/admin/intake/tokens/{token['id']}",
        json={"status": "disabled", "expected_revision": token["revision"]},
    )
    assert disabled.status_code == 200
    assert disabled.json()["status"] == "disabled"
    assert client.get(f"/api/fill/{value}").status_code == 410

    restored = client.patch(
        f"/api/admin/intake/tokens/{token['id']}",
        json={
            "status": "active",
            "expected_revision": disabled.json()["revision"],
        },
    )
    assert restored.status_code == 200
    assert client.get(f"/api/fill/{value}").status_code == 200

    with intake_api_context.session_factory.begin() as session:
        stored = session.get(CustomerFormToken, token["id"])
        assert stored is not None
        stored.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)

    expired = client.get(f"/api/fill/{value}")
    assert expired.status_code == 410
    with intake_api_context.session_factory() as session:
        stored = session.get(CustomerFormToken, token["id"])
        assert stored is not None
        assert stored.status is FormTokenStatus.EXPIRED

    tokens = client.get("/api/admin/intake/tokens").json()["items"]
    expired_token = next(item for item in tokens if item["id"] == token["id"])
    cannot_restore = client.patch(
        f"/api/admin/intake/tokens/{token['id']}",
        json={
            "status": "active",
            "expected_revision": expired_token["revision"],
        },
    )
    assert cannot_restore.status_code == 409


def test_missing_expiry_is_closed_and_access_log_tokens_are_redacted(
    intake_api_context: IntakeApiContext,
) -> None:
    raw_token = "x" * 43
    with intake_api_context.session_factory.begin() as session:
        session.add(
            CustomerFormToken(token_hash=token_digest(raw_token), expires_at=None)
        )

    response = intake_api_context.client.get(f"/api/fill/{raw_token}")
    assert response.status_code == 410
    with intake_api_context.session_factory() as session:
        stored = session.scalar(
            select(CustomerFormToken).where(
                CustomerFormToken.token_hash == token_digest(raw_token)
            )
        )
        assert stored is not None
        assert stored.status is FormTokenStatus.EXPIRED

    record = logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        __file__,
        1,
        '%s - "%s %s HTTP/%s" %d',
        ("127.0.0.1", "GET", f"/api/fill/{raw_token}/submit", "1.1", 200),
        None,
    )
    assert FillTokenRedactionFilter().filter(record)
    assert raw_token not in record.getMessage()
    assert "/api/fill/[redacted]/submit" in record.getMessage()


@pytest.mark.parametrize(
    "payload",
    [
        complete_payload(customer={"name": "缺少联系方式"}),
        complete_payload(service={"start_date": "2031-04-03", "end_date": "2031-04-01", "visits_per_day": 1, "service_items": ["feed"]}),
        complete_payload(service={"start_date": "2031-04-01", "end_date": "2031-04-03", "visits_per_day": 11, "service_items": ["feed"]}),
    ],
)
def test_submission_requires_minimum_valid_information(
    intake_api_context: IntakeApiContext,
    payload: dict[str, object],
) -> None:
    token = create_token(intake_api_context.client)
    response = intake_api_context.client.post(
        f"/api/fill/{token_value(token)}/submit",
        json={
            "expected_revision": token["revision"],
            "idempotency_key": f"submit-invalid-{token['id']}-0000",
            "payload": payload,
        },
    )
    assert response.status_code == 422


def test_public_validation_errors_do_not_echo_sensitive_input(
    intake_api_context: IntakeApiContext,
) -> None:
    token = create_token(intake_api_context.client)
    sensitive_marker = "P10-PRIVATE-INPUT-MUST-NOT-ECHO"
    payload = complete_payload()
    payload["customer"] = {
        **payload["customer"],
        "address": sensitive_marker * 40,
    }

    response = intake_api_context.client.post(
        f"/api/fill/{token_value(token)}/submit",
        json={
            "expected_revision": token["revision"],
            "idempotency_key": f"submit-private-{token['id']}-0000",
            "payload": payload,
        },
    )

    assert response.status_code == 422
    assert sensitive_marker not in response.text
    error = response.json()["detail"][0]
    assert set(error) == {"type", "loc", "msg"}
    assert "input" not in error
    assert "ctx" not in error


def test_submission_is_once_only_and_admin_list_is_privacy_minimized(
    intake_api_context: IntakeApiContext,
) -> None:
    client = intake_api_context.client
    token, summary = submit_for_review(client)
    value = token_value(token)

    assert summary["status"] == "submitted"
    assert summary["customer_name"] == "P10 虚构客户"
    assert summary["community"] is None
    assert summary["cat_count"] == 2
    assert "phone" not in summary
    assert "address" not in summary
    assert "access_info" not in summary
    assert "key_code" not in summary
    assert "payload" not in summary

    public = client.get(f"/api/fill/{value}")
    assert public.status_code == 200
    assert public.json() == {
        "status": "submitted",
        "expires_at": public.json()["expires_at"],
        "draft": None,
        "revision": None,
    }
    assert "TEST-CONTACT" not in public.text
    assert client.put(
        f"/api/fill/{value}",
        json={"expected_revision": summary["revision"], "draft": {}},
    ).status_code == 409
    assert client.post(
        f"/api/fill/{value}/submit",
        json={
            "expected_revision": summary["revision"],
            "idempotency_key": "different-submit-key-0000",
            "payload": complete_payload(),
        },
    ).status_code == 409

    detail = client.get(f"/api/admin/intake/submissions/{summary['id']}")
    assert detail.status_code == 200
    assert detail.json()["payload"]["customer"]["phone"] == "TEST-CONTACT"
    assert detail.json()["payload"]["customer"]["access_info"] is None
    assert detail.json()["payload"]["customer"]["key_code"] is None
    assert [event["event_type"] for event in detail.json()["audit_events"]] == [
        "submitted"
    ]
    assert "TEST-CONTACT" not in str(detail.json()["audit_events"])

    with intake_api_context.session_factory() as session:
        assert session.scalar(select(func.count(Customer.id))) == 0
        assert session.scalar(select(func.count(Order.id))) == 0
        assert session.scalar(select(func.count(CustomerFormSubmission.id))) == 1

    token_list = client.get("/api/admin/intake/tokens").json()["items"]
    submitted_token = next(item for item in token_list if item["id"] == token["id"])
    cannot_disable = client.patch(
        f"/api/admin/intake/tokens/{token['id']}",
        json={
            "status": "disabled",
            "expected_revision": submitted_token["revision"],
        },
    )
    assert cannot_disable.status_code == 409


def test_public_minimum_submission_revision_and_sensitive_fields(
    intake_api_context: IntakeApiContext,
) -> None:
    client = intake_api_context.client
    token = create_token(client)
    value = token_value(token)
    minimum = {
        "customer": {"name": "最少资料客户", "wechat_name": "TEST-WECHAT"},
        "cats": [],
        "service": {},
    }

    forbidden = client.put(
        f"/api/fill/{value}",
        json={
            "expected_revision": token["revision"],
            "draft": {
                **minimum,
                "customer": {
                    **minimum["customer"],
                    "access_info": "公开页禁止的进门说明",
                    "key_code": "PUBLIC-FORBIDDEN-KEY",
                },
            },
        },
    )
    assert forbidden.status_code == 422
    assert "公开页禁止的进门说明" not in forbidden.text
    assert "PUBLIC-FORBIDDEN-KEY" not in forbidden.text

    saved = client.put(
        f"/api/fill/{value}",
        json={"expected_revision": token["revision"], "draft": minimum},
    )
    assert saved.status_code == 200
    assert saved.json()["revision"] != token["revision"]
    assert client.put(
        f"/api/fill/{value}",
        json={"expected_revision": token["revision"], "draft": minimum},
    ).status_code == 409

    idempotency_key = "minimum-submit-idempotency-0001"
    command = {
        "expected_revision": saved.json()["revision"],
        "idempotency_key": idempotency_key,
        "payload": minimum,
    }
    submitted = client.post(f"/api/fill/{value}/submit", json=command)
    assert submitted.status_code == 200
    assert submitted.json()["status"] == "submitted"
    assert client.post(f"/api/fill/{value}/submit", json=command).status_code == 200
    changed = {
        **command,
        "payload": {
            **minimum,
            "customer": {"name": "不同内容", "wechat_name": "TEST-WECHAT"},
        },
    }
    assert client.post(f"/api/fill/{value}/submit", json=changed).status_code == 409


def test_submission_list_supports_pagination(
    intake_api_context: IntakeApiContext,
) -> None:
    client = intake_api_context.client
    for _ in range(3):
        submit_for_review(client)

    page = client.get("/api/admin/intake/submissions?limit=2&offset=1")
    assert page.status_code == 200
    assert page.json()["total"] == 3
    assert len(page.json()["items"]) == 2


def test_customer_only_archive_and_void_are_idempotent(
    intake_api_context: IntakeApiContext,
) -> None:
    client = intake_api_context.client
    _, customer_summary = submit_for_review(client)
    customer_detail = client.get(
        f"/api/admin/intake/submissions/{customer_summary['id']}"
    ).json()
    reviewed = client.put(
        f"/api/admin/intake/submissions/{customer_summary['id']}/review-draft",
        json={
            "review_payload": customer_detail["payload"],
            "unit_price": None,
            "expected_revision": customer_detail["revision"],
        },
    ).json()
    customer_key = "customer-archive-idempotency-0001"
    archived = client.post(
        f"/api/admin/intake/submissions/{customer_summary['id']}/archive-customer",
        json={
            "expected_revision": reviewed["revision"],
            "idempotency_key": customer_key,
        },
    )
    assert archived.status_code == 200
    assert archived.json()["status"] == "archived_customer"
    assert archived.json()["order_id"] is None
    assert client.post(
        f"/api/admin/intake/submissions/{customer_summary['id']}/archive-customer",
        json={
            "expected_revision": reviewed["revision"],
            "idempotency_key": customer_key,
        },
    ).status_code == 200
    assert client.post(
        f"/api/admin/intake/submissions/{customer_summary['id']}/archive-customer",
        json={
            "expected_revision": reviewed["revision"],
            "idempotency_key": "different-customer-key-0001",
        },
    ).status_code == 409
    archived_detail = client.get(
        f"/api/admin/intake/submissions/{customer_summary['id']}"
    ).json()
    assert [event["event_type"] for event in archived_detail["audit_events"]] == [
        "submitted",
        "review_saved",
        "archived_customer",
    ]

    _, void_summary = submit_for_review(client)
    void_key = "void-submission-idempotency-0001"
    voided = client.post(
        f"/api/admin/intake/submissions/{void_summary['id']}/void",
        json={
            "expected_revision": void_summary["revision"],
            "idempotency_key": void_key,
        },
    )
    assert voided.status_code == 200
    assert voided.json()["status"] == "voided"

    with intake_api_context.session_factory() as session:
        customer = session.get(Customer, archived.json()["customer_id"])
        assert customer is not None
        assert customer.archived_at is None
        assert session.scalar(select(func.count(Customer.id))) == 1
        assert session.scalar(select(func.count(Cat.id))) == 2
        assert session.scalar(select(func.count(Order.id))) == 0


def test_review_and_atomic_conversion_create_complete_business_records(
    intake_api_context: IntakeApiContext,
) -> None:
    client = intake_api_context.client
    _, summary = submit_for_review(client)

    detail = client.get(
        f"/api/admin/intake/submissions/{summary['id']}"
    ).json()
    stale_review = client.put(
        f"/api/admin/intake/submissions/{summary['id']}/review-draft",
        json={
            "review_payload": detail["payload"],
            "unit_price": "40.00",
            "expected_revision": "0" * 64,
        },
    )
    assert stale_review.status_code == 409
    review_payload = detail["payload"]
    review_payload["service"]["service_items"] = ["feed", "water", "litter", "photo"]
    reviewed = client.put(
        f"/api/admin/intake/submissions/{summary['id']}/review-draft",
        json={
            "review_payload": review_payload,
            "unit_price": "40.00",
            "expected_revision": summary["revision"],
        },
    )
    assert reviewed.status_code == 200
    assert reviewed.json()["status"] == "reviewed"

    order_key = "order-archive-idempotency-0001"
    old_revision = client.post(
        f"/api/admin/intake/submissions/{summary['id']}/archive-order",
        json={
            "expected_revision": summary["revision"],
            "idempotency_key": order_key,
        },
    )
    assert old_revision.status_code == 409
    converted = client.post(
        f"/api/admin/intake/submissions/{summary['id']}/archive-order",
        json={
            "expected_revision": reviewed.json()["revision"],
            "idempotency_key": order_key,
        },
    )
    assert converted.status_code == 200
    conversion = converted.json()
    assert conversion["status"] == "archived_order"
    converted_detail = client.get(
        f"/api/admin/intake/submissions/{summary['id']}"
    ).json()
    assert converted_detail["audit_events"][-1]["event_type"] == "archived_order"

    with intake_api_context.session_factory() as session:
        customer = session.get(Customer, conversion["customer_id"])
        order = session.get(Order, conversion["order_id"])
        assert customer is not None
        assert customer.geocode_status == "pending"
        assert order is not None
        assert order.customer_id == customer.id
        assert order.order_status.value == "confirmed"
        assert order.pricing_mode == "per_visit"
        assert order.base_price == 40
        assert order.extra_cat_fee == 0
        assert order.stairs_fee == 0
        assert order.other_fee == 0
        assert order.total_amount == 240
        assert session.scalar(select(func.count(Cat.id))) == 2
        assert session.scalar(select(func.count(Task.id))) == 6

    repeated = client.post(
        f"/api/admin/intake/submissions/{summary['id']}/archive-order",
        json={
            "expected_revision": reviewed.json()["revision"],
            "idempotency_key": order_key,
        },
    )
    assert repeated.status_code == 200
    assert repeated.json()["customer_id"] == conversion["customer_id"]
    assert repeated.json()["order_id"] == conversion["order_id"]
    with intake_api_context.session_factory() as session:
        assert session.scalar(select(func.count(Customer.id))) == 1
        assert session.scalar(select(func.count(Order.id))) == 1
        assert session.scalar(select(func.count(Task.id))) == 6


def test_conversion_failure_rolls_back_every_business_record(
    intake_api_context: IntakeApiContext,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = intake_api_context.client
    _, summary = submit_for_review(client)
    detail = client.get(
        f"/api/admin/intake/submissions/{summary['id']}"
    ).json()
    review_payload = detail["payload"]
    review_payload["service"]["service_items"] = ["feed"]
    reviewed = client.put(
        f"/api/admin/intake/submissions/{summary['id']}/review-draft",
        json={
            "review_payload": review_payload,
            "unit_price": "30.00",
            "expected_revision": summary["revision"],
        },
    ).json()

    def fail_order_build(*args: object, **kwargs: object) -> None:
        raise RuntimeError("injected P10 rollback check")

    monkeypatch.setattr("app.services.intake.build_order", fail_order_build)
    with pytest.raises(RuntimeError, match="injected P10 rollback check"):
        client.post(
            f"/api/admin/intake/submissions/{summary['id']}/convert",
            json={"expected_revision": reviewed["revision"]},
        )

    with intake_api_context.session_factory() as session:
        submission = session.get(CustomerFormSubmission, summary["id"])
        assert submission is not None
        assert submission.status is FormSubmissionStatus.REVIEWED
        assert submission.converted_customer_id is None
        assert submission.converted_order_id is None
        assert session.scalar(select(func.count(Customer.id))) == 0
        assert session.scalar(select(func.count(Cat.id))) == 0
        assert session.scalar(select(func.count(Order.id))) == 0
        assert session.scalar(select(func.count(Task.id))) == 0
