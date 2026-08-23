from collections.abc import Generator
from dataclasses import dataclass
from datetime import datetime, time, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.db.session import build_engine, get_db
from app.main import app
from app.models import Order, Task, TaskItem, TaskPhoto
from app.models.enums import (
    OrderPaymentStatus,
    PaymentMethod,
    PaymentRecordStatus,
    TaskItemType,
    TaskStatus,
)
from app.models.payment import Payment


@dataclass(frozen=True)
class DashboardApiContext:
    client: TestClient
    session_factory: sessionmaker[Session]


@pytest.fixture
def dashboard_api_context(
    migrated_database_url: str,
) -> Generator[DashboardApiContext, None, None]:
    engine = build_engine(migrated_database_url)
    testing_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db() -> Generator[Session, None, None]:
        with testing_session() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            yield DashboardApiContext(client=client, session_factory=testing_session)
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def create_customer(
    client: TestClient,
    *,
    name: str,
    key_status: str | None = None,
    medication_required: bool = False,
) -> tuple[dict, dict]:
    customer_response = client.post(
        "/api/admin/customers",
        json={
            "name": name,
            "phone": "FAKE-P7-PHONE",
            "wechat_name": "P7 虚构微信",
            "community": "P7 虚构小区",
            "address": "P7 不对应真实地点的详细地址",
            "access_method": "P7 虚构门禁",
            "access_info": "P7 虚构入户说明",
            "key_status": key_status,
            "key_code": "FAKE-P7-KEY-CODE",
            "notes": "P7 不应进入工作台的客户备注",
        },
    )
    assert customer_response.status_code == 201
    customer = customer_response.json()
    cat_response = client.post(
        f"/api/admin/customers/{customer['id']}/cats",
        json={
            "name": f"{name}的虚构猫咪",
            "medication_required": medication_required,
            "medication_notes": "P7 虚构喂药说明" if medication_required else None,
            "service_notes": "P7 不应进入工作台的服务详情",
        },
    )
    assert cat_response.status_code == 201
    return customer, cat_response.json()


def create_order(
    client: TestClient,
    *,
    customer_id: int,
    cat_id: int,
    start_date: str,
    end_date: str,
    visits_per_day: int = 1,
    service_items: list[str] | None = None,
    order_status: str = "confirmed",
) -> dict:
    response = client.post(
        "/api/admin/orders",
        json={
            "customer_id": customer_id,
            "cat_ids": [cat_id],
            "start_date": start_date,
            "end_date": end_date,
            "visits_per_day": visits_per_day,
            "service_items": service_items or ["feed", "photo"],
            "base_price": "30.00",
            "stairs_fee": "0.00",
            "other_fee": "0.00",
            "order_status": order_status,
            "notes": "P7 不应进入工作台的订单备注",
        },
    )
    assert response.status_code == 201
    return response.json()


def test_dashboard_empty_state_and_date_validation(
    dashboard_api_context: DashboardApiContext,
) -> None:
    response = dashboard_api_context.client.get(
        "/api/admin/dashboard",
        params={"date": "2035-10-06"},
    )
    assert response.status_code == 200
    assert response.json() == {
        "business_date": "2035-10-06",
        "month_start": "2035-10-01",
        "metrics": {
            "today_order_count": 0,
            "pending_task_count": 0,
            "pending_payment_count": 0,
            "month_income": "0.00",
        },
        "schedule": [],
        "reminders": [],
    }
    assert dashboard_api_context.client.get(
        "/api/admin/dashboard",
        params={"date": "not-a-date"},
    ).status_code == 422


def test_dashboard_aggregates_schedule_reminders_and_privacy(
    dashboard_api_context: DashboardApiContext,
) -> None:
    client = dashboard_api_context.client
    customer, cat = create_customer(
        client,
        name="P7 今日客户（虚构）",
        key_status="待取",
        medication_required=True,
    )
    today_order = create_order(
        client,
        customer_id=customer["id"],
        cat_id=cat["id"],
        start_date="2035-10-06",
        end_date="2035-10-06",
        visits_per_day=2,
    )
    tomorrow_customer, tomorrow_cat = create_customer(
        client,
        name="P7 明日客户（虚构）",
    )
    tomorrow_order = create_order(
        client,
        customer_id=tomorrow_customer["id"],
        cat_id=tomorrow_cat["id"],
        start_date="2035-10-07",
        end_date="2035-10-08",
    )
    prior_customer, prior_cat = create_customer(
        client,
        name="P7 前日客户（虚构）",
    )
    prior_order = create_order(
        client,
        customer_id=prior_customer["id"],
        cat_id=prior_cat["id"],
        start_date="2035-10-05",
        end_date="2035-10-05",
    )
    cancelled_customer, cancelled_cat = create_customer(
        client,
        name="P7 已取消客户（虚构）",
        key_status="待取",
        medication_required=True,
    )
    cancelled_order = create_order(
        client,
        customer_id=cancelled_customer["id"],
        cat_id=cancelled_cat["id"],
        start_date="2035-10-06",
        end_date="2035-10-06",
    )
    assert client.patch(
        f"/api/admin/orders/{cancelled_order['id']}/status",
        json={"order_status": "cancelled"},
    ).status_code == 200

    with dashboard_api_context.session_factory.begin() as session:
        order = session.get(Order, today_order["id"])
        assert order is not None
        order.paid_amount = Decimal("10.00")
        order.payment_status = OrderPaymentStatus.PARTIAL
        tasks = list(
            session.scalars(
                select(Task)
                .where(Task.order_id == order.id)
                .order_by(Task.sort_order)
            )
        )
        tasks[0].status = TaskStatus.READY
        tasks[0].planned_time = time(9, 30)
        tasks[1].status = TaskStatus.COMPLETED
        tasks[1].planned_time = time(16, 45)
        tasks[1].completed_at = datetime(2035, 10, 6, 9, 0, tzinfo=timezone.utc)
        tasks[1].photos.append(
            TaskPhoto(file_url="/uploads/tasks/2035/10/06/private-fake-photo.png")
        )
        prior_order_model = session.get(Order, prior_order["id"])
        assert prior_order_model is not None
        prior_order_model.paid_amount = prior_order_model.total_amount
        prior_order_model.payment_status = OrderPaymentStatus.PAID
        prior_task = session.get(Task, prior_order["tasks"][0]["id"])
        assert prior_task is not None
        prior_task.status = TaskStatus.COMPLETED
        prior_task.completed_at = datetime(2035, 10, 5, 9, 0, tzinfo=timezone.utc)
        prior_task.photos.append(
            TaskPhoto(file_url="/uploads/tasks/2035/10/05/prior-day-private.png")
        )
        session.add_all(
            [
                Payment(
                    order_id=order.id,
                    customer_id=customer["id"],
                    amount=Decimal("88.50"),
                    payment_method=PaymentMethod.WECHAT,
                    payment_status=PaymentRecordStatus.COMPLETED,
                    paid_at=datetime(2035, 9, 30, 16, 0, tzinfo=timezone.utc),
                ),
                Payment(
                    order_id=order.id,
                    customer_id=customer["id"],
                    amount=Decimal("100.00"),
                    payment_method=PaymentMethod.CASH,
                    payment_status=PaymentRecordStatus.PENDING,
                    paid_at=datetime(2035, 10, 2, 8, 0, tzinfo=timezone.utc),
                ),
                Payment(
                    order_id=order.id,
                    customer_id=customer["id"],
                    amount=Decimal("30.00"),
                    payment_method=PaymentMethod.ALIPAY,
                    payment_status=PaymentRecordStatus.REFUNDED,
                    paid_at=datetime(2035, 10, 3, 8, 0, tzinfo=timezone.utc),
                ),
                Payment(
                    order_id=order.id,
                    customer_id=customer["id"],
                    amount=Decimal("40.00"),
                    payment_method=PaymentMethod.OTHER,
                    payment_status=PaymentRecordStatus.COMPLETED,
                    paid_at=datetime(2035, 9, 30, 15, 59, 59, tzinfo=timezone.utc),
                ),
                Payment(
                    order_id=order.id,
                    customer_id=customer["id"],
                    amount=Decimal("50.00"),
                    payment_method=PaymentMethod.OTHER,
                    payment_status=PaymentRecordStatus.COMPLETED,
                    paid_at=datetime(2035, 10, 31, 16, 0, tzinfo=timezone.utc),
                ),
            ]
        )

    response = client.get("/api/admin/dashboard", params={"date": "2035-10-06"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["metrics"] == {
        "today_order_count": 1,
        "pending_task_count": 1,
        "pending_payment_count": 2,
        "month_income": "88.50",
    }
    assert [item["id"] for item in payload["schedule"]] == [
        today_order["tasks"][0]["id"],
        today_order["tasks"][1]["id"],
    ]
    assert [item["status"] for item in payload["schedule"]] == [
        "ready",
        "completed",
    ]
    assert payload["schedule"][0] == {
        "id": today_order["tasks"][0]["id"],
        "order_id": today_order["id"],
        "planned_time": "09:30:00",
        "sort_order": 0,
        "status": "ready",
        "customer_name": "P7 今日客户（虚构）",
        "community": "P7 虚构小区",
        "address": "P7 不对应真实地点的详细地址",
        "cat_count": 1,
    }

    reminders = {item["id"]: item for item in payload["reminders"]}
    assert f"key_pickup:order:{today_order['id']}" in reminders
    assert f"medicine:task:{today_order['tasks'][0]['id']}" in reminders
    photo_reminder = reminders[
        f"photos_pending:task:{today_order['tasks'][1]['id']}"
    ]
    assert len(photo_reminder["expected_revision"]) == 64
    prior_photo_reminder = reminders[
        f"photos_pending:task:{prior_order['tasks'][0]['id']}"
    ]
    assert "10-05" in prior_photo_reminder["message"]
    assert len(prior_photo_reminder["expected_revision"]) == 64
    assert f"payment_due:order:{today_order['id']}" in reminders
    assert f"payment_due:order:{tomorrow_order['id']}" in reminders
    assert f"last_service:order:{today_order['id']}" in reminders
    assert f"order_starts_tomorrow:order:{tomorrow_order['id']}" in reminders

    body = response.text
    for forbidden in (
        "FAKE-P7-PHONE",
        "P7 虚构微信",
        "P7 虚构门禁",
        "FAKE-P7-KEY-CODE",
        "P7 不应进入工作台的客户备注",
        "P7 不应进入工作台的订单备注",
        "private-fake-photo.png",
        "prior-day-private.png",
        "/uploads/",
    ):
        assert forbidden not in body
    assert "P7 已取消客户（虚构）" not in body


def test_medicine_completed_and_noncanonical_key_do_not_trigger(
    dashboard_api_context: DashboardApiContext,
) -> None:
    client = dashboard_api_context.client
    customer, cat = create_customer(
        client,
        name="P7 精确规则客户（虚构）",
        key_status="待领取",
        medication_required=True,
    )
    order = create_order(
        client,
        customer_id=customer["id"],
        cat_id=cat["id"],
        start_date="2035-10-06",
        end_date="2035-10-07",
        service_items=["medicine"],
    )
    with dashboard_api_context.session_factory.begin() as session:
        task = session.get(Task, order["tasks"][0]["id"])
        assert task is not None
        medicine = next(
            item for item in task.items if item.item_type is TaskItemType.MEDICINE
        )
        medicine.completed = True

    payload = client.get(
        "/api/admin/dashboard",
        params={"date": "2035-10-06"},
    ).json()
    kinds = [item["kind"] for item in payload["reminders"]]
    assert "key_pickup" not in kinds
    assert "medicine" not in kinds


def test_mark_photos_sent_is_revision_protected_and_removes_reminder(
    dashboard_api_context: DashboardApiContext,
) -> None:
    client = dashboard_api_context.client
    customer, cat = create_customer(client, name="P7 照片客户（虚构）")
    order = create_order(
        client,
        customer_id=customer["id"],
        cat_id=cat["id"],
        start_date="2035-10-06",
        end_date="2035-10-06",
        service_items=["photo"],
    )
    task_id = order["tasks"][0]["id"]
    with dashboard_api_context.session_factory.begin() as session:
        task = session.get(Task, task_id)
        assert task is not None
        task.status = TaskStatus.COMPLETED
        task.completed_at = datetime(2035, 10, 6, 8, 0, tzinfo=timezone.utc)
        photo_item = next(
            item for item in task.items if item.item_type is TaskItemType.PHOTO
        )
        photo_item.completed = True
        task.photos.append(
            TaskPhoto(file_url="/uploads/tasks/2035/10/06/p7-fake.png")
        )

    before = client.get(
        "/api/admin/dashboard",
        params={"date": "2035-10-06"},
    ).json()
    reminder = next(
        item for item in before["reminders"] if item["kind"] == "photos_pending"
    )
    original_revision = reminder["expected_revision"]
    sent = client.post(
        f"/api/admin/dashboard/tasks/{task_id}/photos-sent",
        json={"expected_revision": original_revision},
    )
    assert sent.status_code == 200
    assert sent.json()["photos_sent_at"].endswith("Z")
    assert sent.json()["revision"] != original_revision

    after = client.get(
        "/api/admin/dashboard",
        params={"date": "2035-10-06"},
    ).json()
    assert all(item["kind"] != "photos_pending" for item in after["reminders"])
    task_detail = client.get(f"/api/admin/tasks/{task_id}").json()
    assert task_detail["photos_sent_at"].endswith("Z")
    assert task_detail["revision"] == sent.json()["revision"]
    assert client.post(
        f"/api/admin/dashboard/tasks/{task_id}/photos-sent",
        json={"expected_revision": original_revision},
    ).status_code == 409

    open_customer, open_cat = create_customer(client, name="P7 未完成照片客户（虚构）")
    open_order = create_order(
        client,
        customer_id=open_customer["id"],
        cat_id=open_cat["id"],
        start_date="2035-10-06",
        end_date="2035-10-07",
        service_items=["feed"],
    )
    open_task_id = open_order["tasks"][0]["id"]
    with dashboard_api_context.session_factory.begin() as session:
        open_task = session.get(Task, open_task_id)
        assert open_task is not None
        open_task.photos.append(
            TaskPhoto(file_url="/uploads/tasks/2035/10/06/open-fake.png")
        )
    open_detail = client.get(f"/api/admin/tasks/{open_task_id}").json()
    assert client.post(
        f"/api/admin/dashboard/tasks/{open_task_id}/photos-sent",
        json={"expected_revision": open_detail["revision"]},
    ).status_code == 409
