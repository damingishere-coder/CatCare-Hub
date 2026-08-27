from collections import Counter
from collections.abc import Generator
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.db.session import build_engine, get_db
from app.main import app
from app.models import (
    Cat,
    Customer,
    CustomerFormSubmission,
    CustomerFormToken,
    Order,
    Payment,
    Task,
    TaskItem,
    TaskPhoto,
)
from app.models.enums import FormSubmissionStatus, FormTokenStatus
from app.services import task_uploads
from app.services.credentials import token_digest


TRUSTED_ORIGIN = "http://localhost:5180"


@dataclass(frozen=True)
class P13Context:
    client: TestClient
    session_factory: sessionmaker[Session]
    upload_root: Path


@pytest.fixture
def p13_context(
    migrated_database_url: str,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[P13Context, None, None]:
    engine = build_engine(migrated_database_url)
    testing_session = sessionmaker(
        bind=engine,
        autoflush=False,
        expire_on_commit=False,
    )
    upload_root = (tmp_path / "p13-uploads").resolve()
    monkeypatch.setattr(task_uploads, "UPLOAD_ROOT", upload_root)
    monkeypatch.setenv("CATCARE_TRUSTED_ORIGINS", TRUSTED_ORIGIN)
    monkeypatch.setenv("CATCARE_MAP_PROVIDER", "disabled")

    def override_get_db() -> Generator[Session, None, None]:
        with testing_session() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app, headers={"Origin": TRUSTED_ORIGIN}) as client:
            yield P13Context(
                client=client,
                session_factory=testing_session,
                upload_root=upload_root,
            )
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def image_bytes() -> bytes:
    output = BytesIO()
    Image.new("RGB", (4, 3), color=(31, 41, 55)).save(output, format="PNG")
    return output.getvalue()


def complete_mobile_task(
    client: TestClient,
    task_id: int,
    *,
    upload_photo: bool = False,
) -> dict:
    detail_response = client.get(f"/api/mobile/tasks/{task_id}")
    assert detail_response.status_code == 200
    detail = detail_response.json()

    started = client.post(
        f"/api/mobile/tasks/{task_id}/start",
        json={"expected_revision": detail["revision"]},
    )
    assert started.status_code == 200
    detail = started.json()

    notes = client.put(
        f"/api/mobile/tasks/{task_id}/notes",
        json={
            "expected_revision": detail["revision"],
            "notes": "P13 虚构执行记录：已完成服务",
            "cat_status": "P13 虚构状态：精神良好",
        },
    )
    assert notes.status_code == 200
    detail = notes.json()

    for item in detail["items"]:
        if item["completed"] or item["item_type"] == "photo":
            continue
        checked = client.patch(
            f"/api/mobile/tasks/{task_id}/items/{item['id']}",
            json={"expected_revision": detail["revision"], "completed": True},
        )
        assert checked.status_code == 200
        detail = checked.json()

    if upload_photo:
        uploaded = client.post(
            f"/api/mobile/tasks/{task_id}/photos",
            data={"expected_revision": detail["revision"]},
            files={
                "photo": (
                    "../../P13-not-a-customer-name.png",
                    image_bytes(),
                    "image/png",
                )
            },
        )
        assert uploaded.status_code == 200
        detail = uploaded.json()
        assert len(detail["photos"]) == 1

    completed = client.post(
        f"/api/mobile/tasks/{task_id}/complete",
        json={"expected_revision": detail["revision"]},
    )
    assert completed.status_code == 200
    assert completed.json()["status"] == "completed"
    return completed.json()


def fill_payload() -> dict[str, object]:
    return {
        "customer": {
            "name": "P13 填写客户（完全虚构）",
            "wechat_name": "P13-FILL-WECHAT",
            "phone": "P13-FILL-CONTACT",
            "community": "P13 虚构小区",
            "address": "P13 不对应任何真实地点的地址",
            "building": "P13 测试楼栋",
            "unit": "P13 测试单元",
            "room": "P13 测试房号",
            "access_method": "P13 虚构门禁方式",
            "access_info": "P13 虚构入户说明",
            "key_status": "P13 测试状态",
            "key_code": "P13-FAKE-KEY",
            "notes": "P13 虚构填写备注",
        },
        "cats": [
            {
                "name": "P13 填写猫甲",
                "food": "P13 虚构主食",
                "medication_required": False,
                "service_notes": "P13 虚构服务说明甲",
            },
            {
                "name": "P13 填写猫乙",
                "medication_required": True,
                "medication_notes": "P13 虚构用药说明",
                "service_notes": "P13 虚构服务说明乙",
            },
        ],
        "service": {
            "start_date": "2036-07-10",
            "end_date": "2036-07-12",
            "visits_per_day": 2,
            "service_items": ["feed", "water", "litter", "photo"],
        },
        "notes": "P13 虚构填写订单备注",
    }


def public_fill_payload() -> dict[str, object]:
    payload = fill_payload()
    customer = payload["customer"]
    cats = payload["cats"]
    service = payload["service"]
    assert isinstance(customer, dict)
    assert isinstance(cats, list)
    assert isinstance(service, dict)
    return {
        "customer": {
            key: customer[key]
            for key in (
                "name",
                "wechat_name",
                "phone",
                "address",
                "access_method",
                "key_status",
                "notes",
            )
        },
        "cats": [
            {
                key: cat[key]
                for key in (
                    "name",
                    "food",
                    "medication_required",
                    "medication_notes",
                )
                if key in cat
            }
            for cat in cats
            if isinstance(cat, dict)
        ],
        "service": {
            key: service[key]
            for key in ("start_date", "end_date", "visits_per_day")
        },
        "notes": payload["notes"],
    }


def test_p13_local_business_lifecycle(p13_context: P13Context) -> None:
    client = p13_context.client
    assert client.get("/api/admin/customers").status_code == 200

    customer_response = client.post(
        "/api/admin/customers",
        json={
            "name": "P13 业务客户（完全虚构）",
            "phone": "P13-NOT-A-REAL-PHONE",
            "community": "P13 虚构小区",
            "address": "P13 不对应任何真实地点的地址",
            "access_method": "P13 虚构门禁方式",
            "access_info": "P13 虚构入户说明",
            "key_status": "P13 测试状态",
            "key_code": "P13-FAKE-KEY",
            "notes": "P13 虚构客户备注",
        },
    )
    assert customer_response.status_code == 201
    customer = customer_response.json()
    cats = []
    for name in ("P13 业务猫甲", "P13 业务猫乙"):
        cat_response = client.post(
            f"/api/admin/customers/{customer['id']}/cats",
            json={"name": name, "service_notes": f"{name}的虚构服务说明"},
        )
        assert cat_response.status_code == 201
        cats.append(cat_response.json())

    order_response = client.post(
        "/api/admin/orders",
        json={
            "customer_id": customer["id"],
            "cat_ids": [cat["id"] for cat in cats],
            "start_date": "2036-06-01",
            "end_date": "2036-06-03",
                "visits_per_day": 2,
                "settlement_mode": "order_total",
                "service_items": ["feed", "water"],
            "base_price": "30.00",
            "stairs_fee": "5.00",
            "other_fee": "12.00",
            "order_status": "confirmed",
            "notes": "P13 虚构跨天订单备注",
        },
    )
    assert order_response.status_code == 201, order_response.text
    order = order_response.json()
    assert order["service_days"] == 3
    assert order["total_visits"] == 6
    assert order["task_count"] == 6
    assert order["extra_cat_fee"] == "5.00"
    assert order["total_amount"] == "252.00"
    assert order["paid_amount"] == "0"
    assert order["due_amount"] == "252.00"
    assert order["payment_status"] == "unpaid"
    assert Counter(task["service_date"] for task in order["tasks"]) == {
        "2036-06-01": 2,
        "2036-06-02": 2,
        "2036-06-03": 2,
    }
    assert all(len(task["items"]) == 2 for task in order["tasks"])

    initial_day = client.get("/api/admin/plans/2036-06-01").json()
    original_ids = [task["id"] for task in initial_day["tasks"]]
    reversed_ids = list(reversed(original_ids))
    schedule = {
        "expected_revision": initial_day["revision"],
        "tasks": [
            {"task_id": reversed_ids[0], "planned_time": "10:40"},
            {"task_id": reversed_ids[1], "planned_time": "09:20"},
        ],
    }
    saved_response = client.put(
        "/api/admin/plans/2036-06-01/schedule",
        json=schedule,
    )
    assert saved_response.status_code == 200
    saved = saved_response.json()
    assert [task["id"] for task in saved["tasks"]] == reversed_ids
    assert [task["planned_time"] for task in saved["tasks"]] == [
        "10:40:00",
        "09:20:00",
    ]
    stale = client.put("/api/admin/plans/2036-06-01/schedule", json=schedule)
    assert stale.status_code == 409
    assert client.get("/api/admin/plans/2036-06-01").json() == saved

    mobile_day = client.get("/api/mobile/today", params={"date": "2036-06-01"})
    assert mobile_day.status_code == 200
    assert [task["id"] for task in mobile_day.json()["tasks"]] == reversed_ids

    completed_tasks = []
    for index, task in enumerate(order["tasks"]):
        completed_tasks.append(
            complete_mobile_task(
                client,
                task["id"],
                upload_photo=index == 0,
            )
        )
    assert all(task["status"] == "completed" for task in completed_tasks)
    assert completed_tasks[-1]["order_status"] == "completed"

    photo = completed_tasks[0]["photos"][0]
    photo_response = client.get(photo["url"])
    assert photo_response.status_code == 200
    assert photo_response.content == image_bytes()
    assert photo_response.headers["cache-control"] == "private, no-store"

    with p13_context.session_factory() as session:
        stored_photo = session.get(TaskPhoto, photo["id"])
        assert stored_photo is not None
        assert stored_photo.file_url.startswith("/uploads/tasks/2036/06/01/")
        assert "P13-not-a-customer-name" not in stored_photo.file_url
        stored_path = task_uploads.resolve_photo_path(stored_photo.file_url)
        assert stored_path is not None and stored_path.is_file()
        assert stored_path.is_relative_to(p13_context.upload_root)

    completed_order = client.get(f"/api/admin/orders/{order['id']}").json()
    assert completed_order["order_status"] == "completed"
    overview = client.get(
        "/api/admin/payments",
        params={"date": "2036-06-03"},
    ).json()
    receivable = next(
        item for item in overview["receivables"] if item["order_id"] == order["id"]
    )
    assert receivable["due_amount"] == "252.00"

    partial_response = client.post(
        "/api/admin/payments",
        json={
            "order_id": order["id"],
            "amount": "50.00",
            "payment_method": "wechat",
            "paid_at": "2036-06-03T09:00:00+08:00",
            "notes": "P13 虚构部分收款",
            "expected_revision": receivable["revision"],
        },
    )
    assert partial_response.status_code == 201
    partial = partial_response.json()["order"]
    assert partial["payment_status"] == "partial"
    assert partial["paid_amount"] == "50.00"
    assert partial["due_amount"] == "202.00"

    final_response = client.post(
        "/api/admin/payments",
        json={
            "order_id": order["id"],
            "amount": "202.00",
            "payment_method": "cash",
            "paid_at": "2036-06-03T10:00:00+08:00",
            "notes": "P13 虚构尾款",
            "expected_revision": partial["revision"],
        },
    )
    assert final_response.status_code == 201
    paid = final_response.json()["order"]
    assert paid["payment_status"] == "paid"
    assert paid["paid_amount"] == "252.00"
    assert paid["due_amount"] == "0.00"

    refreshed = client.get(
        "/api/admin/payments",
        params={"date": "2036-06-03"},
    ).json()
    assert refreshed["metrics"]["today_income"] == "252.00"
    assert not any(
        item["order_id"] == order["id"] for item in refreshed["receivables"]
    )
    assert len(refreshed["records"]) == 2

    with p13_context.session_factory() as session:
        assert session.scalar(select(func.count(Customer.id))) == 1
        assert session.scalar(select(func.count(Cat.id))) == 2
        assert session.scalar(select(func.count(Order.id))) == 1
        assert session.scalar(select(func.count(Task.id))) == 6
        assert session.scalar(select(func.count(TaskItem.id))) == 12
        assert session.scalar(select(func.count(TaskPhoto.id))) == 1
        assert session.scalar(select(func.count(Payment.id))) == 2


def test_p13_fill_token_lifecycle(p13_context: P13Context) -> None:
    client = p13_context.client
    created_response = client.post(
        "/api/admin/intake/tokens",
        json={"expires_in_days": 14},
    )
    assert created_response.status_code == 201
    created = created_response.json()
    raw_token = created["fill_path"].rsplit("/", 1)[-1]
    assert len(raw_token) >= 40
    listed = client.get("/api/admin/intake/tokens").json()["items"]
    assert next(item for item in listed if item["id"] == created["id"])[
        "fill_path"
    ] is None
    assert client.get(f"/api/fill/{'x' * 43}").status_code == 404
    draft_response = client.put(
        f"/api/fill/{raw_token}",
        json={
            "expected_revision": created["revision"],
            "draft": public_fill_payload(),
        },
    )
    assert draft_response.status_code == 200
    assert len(draft_response.json()["draft"]["cats"]) == 2
    submit_command = {
        "expected_revision": draft_response.json()["revision"],
        "idempotency_key": "p13-submit-idempotency-0001",
        "payload": public_fill_payload(),
    }
    submitted_response = client.post(
        f"/api/fill/{raw_token}/submit",
        json=submit_command,
    )
    assert submitted_response.status_code == 200
    assert submitted_response.json()["status"] == "submitted"
    assert client.post(
        f"/api/fill/{raw_token}/submit",
        json=submit_command,
    ).status_code == 200

    summaries = client.get("/api/admin/intake/submissions").json()["items"]
    summary = next(item for item in summaries if item["customer_name"].startswith("P13"))
    assert summary["cat_count"] == 2
    reviewed_response = client.put(
        f"/api/admin/intake/submissions/{summary['id']}/review-draft",
        json={
            "expected_revision": summary["revision"],
            "review_payload": fill_payload(),
            "unit_price": "35.00",
        },
    )
    assert reviewed_response.status_code == 200
    reviewed = reviewed_response.json()
    assert reviewed["status"] == "reviewed"
    converted_response = client.post(
        f"/api/admin/intake/submissions/{summary['id']}/convert",
        json={"expected_revision": reviewed["revision"]},
    )
    assert converted_response.status_code == 200
    conversion = converted_response.json()
    assert conversion["status"] == "archived_order"
    repeated = client.post(
        f"/api/admin/intake/submissions/{summary['id']}/convert",
        json={"expected_revision": reviewed["revision"]},
    )
    assert repeated.status_code == 200
    assert repeated.json()["customer_id"] == conversion["customer_id"]
    assert repeated.json()["order_id"] == conversion["order_id"]

    disabled_created = client.post(
        "/api/admin/intake/tokens",
        json={"expires_in_days": 14},
    ).json()
    disabled_raw = disabled_created["fill_path"].rsplit("/", 1)[-1]
    disabled_response = client.patch(
        f"/api/admin/intake/tokens/{disabled_created['id']}",
        json={
            "status": "disabled",
            "expected_revision": disabled_created["revision"],
        },
    )
    assert disabled_response.status_code == 200

    expired_created = client.post(
        "/api/admin/intake/tokens",
        json={"expires_in_days": 14},
    ).json()
    expired_raw = expired_created["fill_path"].rsplit("/", 1)[-1]
    with p13_context.session_factory.begin() as session:
        stored = session.get(CustomerFormToken, expired_created["id"])
        assert stored is not None
        stored.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)

    assert client.get(f"/api/fill/{disabled_raw}").status_code == 410
    assert client.get(f"/api/fill/{expired_raw}").status_code == 410

    with p13_context.session_factory() as session:
        converted_submission = session.get(CustomerFormSubmission, summary["id"])
        assert converted_submission is not None
        assert converted_submission.status is FormSubmissionStatus.ARCHIVED_ORDER
        converted_order = session.get(Order, conversion["order_id"])
        assert converted_order is not None
        assert converted_order.total_amount == 210
        assert session.scalar(select(func.count(Customer.id))) == 1
        assert session.scalar(select(func.count(Cat.id))) == 2
        assert session.scalar(select(func.count(Order.id))) == 1
        assert session.scalar(select(func.count(Task.id))) == 6
        stored_token = session.scalar(
            select(CustomerFormToken).where(
                CustomerFormToken.token_hash == token_digest(raw_token)
            )
        )
        assert stored_token is not None
        assert not hasattr(stored_token, "token")
        expired_token = session.get(CustomerFormToken, expired_created["id"])
        assert expired_token is not None
        assert expired_token.status is FormTokenStatus.EXPIRED
