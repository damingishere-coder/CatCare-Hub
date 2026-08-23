from collections import Counter
from collections.abc import Generator
from dataclasses import dataclass
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.db.session import build_engine, get_db
from app.main import app
from app.models import (
    Customer,
    Order,
    OrderPaymentStatus,
    Payment,
    PaymentMethod,
    Task,
    TaskItem,
    TaskPhoto,
    TaskStatus,
)


@dataclass(frozen=True)
class OrderApiContext:
    client: TestClient
    session_factory: sessionmaker[Session]


@pytest.fixture
def order_api_context(
    migrated_database_url: str,
) -> Generator[OrderApiContext, None, None]:
    engine = build_engine(migrated_database_url)
    testing_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db() -> Generator[Session, None, None]:
        with testing_session() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            yield OrderApiContext(client=client, session_factory=testing_session)
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def create_customer_with_cats(
    client: TestClient,
    *,
    name: str = "订单测试客户（虚构）",
    cat_names: tuple[str, ...] = ("订单测试猫甲", "订单测试猫乙"),
) -> tuple[dict, list[dict]]:
    customer_response = client.post("/api/admin/customers", json={"name": name})
    assert customer_response.status_code == 201
    customer = customer_response.json()
    cats = []
    for cat_name in cat_names:
        response = client.post(
            f"/api/admin/customers/{customer['id']}/cats",
            json={"name": cat_name, "service_notes": "虚构订单测试说明"},
        )
        assert response.status_code == 201
        cats.append(response.json())
    return customer, cats


def order_payload(
    customer_id: int,
    cat_ids: list[int],
    **overrides: object,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "customer_id": customer_id,
        "cat_ids": cat_ids,
        "start_date": "2030-10-01",
        "end_date": "2030-10-07",
        "visits_per_day": 1,
        "service_items": ["feed", "water", "litter", "photo"],
        "base_price": "30.00",
        "stairs_fee": "0.00",
        "other_fee": "0.00",
        "order_status": "pending_confirmation",
        "notes": "仅用于订单自动测试",
    }
    payload.update(overrides)
    return payload


def simple_order_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "customer_name": "日历订单新客户（虚构）",
        "cat_count": 3,
        "service_dates": ["2032-03-02", "2032-03-05", "2032-03-09"],
        "service_items": ["feed", "water", "litter", "photo"],
        "unit_price": "42.00",
        "notes": "不连续日期测试",
    }
    payload.update(overrides)
    return payload


def test_create_seven_day_order_generates_tasks_and_private_summary(
    order_api_context: OrderApiContext,
) -> None:
    client = order_api_context.client
    customer, cats = create_customer_with_cats(client)

    response = client.post(
        "/api/admin/orders",
        json=order_payload(customer["id"], [cat["id"] for cat in cats]),
    )

    assert response.status_code == 201
    order = response.json()
    assert order["service_days"] == 7
    assert order["total_visits"] == 7
    assert order["task_count"] == 7
    assert order["extra_cat_fee"] == "5.00"
    assert order["total_amount"] == "245.00"
    assert order["due_amount"] == "245.00"
    assert order["payment_status"] == "unpaid"
    assert len(order["tasks"]) == 7
    assert all(len(task["items"]) == 4 for task in order["tasks"])
    assert all(task["status"] == "pending" for task in order["tasks"])

    list_response = client.get("/api/admin/orders")
    assert list_response.status_code == 200
    summary = list_response.json()["items"][0]
    assert set(summary["customer"]) == {"id", "name", "community", "address"}
    assert "phone" not in summary["customer"]
    assert summary["customer"]["address"] is None
    assert "access_info" not in summary["customer"]
    assert "key_code" not in summary["customer"]
    assert "notes" not in summary


def test_multi_visit_order_generates_two_tasks_per_day_and_server_total(
    order_api_context: OrderApiContext,
) -> None:
    client = order_api_context.client
    customer, cats = create_customer_with_cats(
        client,
        cat_names=("三猫测试甲", "三猫测试乙", "三猫测试丙"),
    )
    payload = order_payload(
        customer["id"],
        [cat["id"] for cat in cats],
        end_date="2030-10-03",
        visits_per_day=2,
        service_items=["feed", "medicine"],
        stairs_fee="5.00",
        other_fee="12.34",
        order_status="confirmed",
    )

    response = client.post("/api/admin/orders", json=payload)

    assert response.status_code == 201
    order = response.json()
    assert order["total_visits"] == 6
    assert order["extra_cat_fee"] == "10.00"
    assert order["total_amount"] == "282.34"
    assert Counter(task["service_date"] for task in order["tasks"]) == {
        "2030-10-01": 2,
        "2030-10-02": 2,
        "2030-10-03": 2,
    }
    assert {task["sort_order"] for task in order["tasks"]} == {0, 1}
    assert all(task["status"] == "confirmed" for task in order["tasks"])
    assert all(
        [item["item_type"] for item in task["items"]] == ["feed", "medicine"]
        for task in order["tasks"]
    )

    forged_total = {**payload, "total_amount": "1.00"}
    assert client.post("/api/admin/orders", json=forged_total).status_code == 422


def test_update_unstarted_order_rebuilds_tasks_and_syncs_status(
    order_api_context: OrderApiContext,
) -> None:
    client = order_api_context.client
    customer, cats = create_customer_with_cats(client)
    initial_payload = order_payload(
        customer["id"],
        [cats[0]["id"]],
        end_date="2030-10-02",
        service_items=["feed"],
    )
    created = client.post("/api/admin/orders", json=initial_payload).json()

    updated_payload = {
        **initial_payload,
        "cat_ids": [cat["id"] for cat in cats],
        "end_date": "2030-10-03",
        "visits_per_day": 2,
        "service_items": ["feed", "water"],
        "order_status": "confirmed",
    }
    update_response = client.put(
        f"/api/admin/orders/{created['id']}",
        json=updated_payload,
    )

    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["task_count"] == 6
    assert len(updated["cats"]) == 2
    assert updated["extra_cat_fee"] == "5.00"
    assert all(task["status"] == "confirmed" for task in updated["tasks"])
    assert all(len(task["items"]) == 2 for task in updated["tasks"])

    cancelled = client.patch(
        f"/api/admin/orders/{created['id']}/status",
        json={"order_status": "cancelled"},
    )
    assert cancelled.status_code == 200
    assert all(task["status"] == "cancelled" for task in cancelled.json()["tasks"])

    restored = client.patch(
        f"/api/admin/orders/{created['id']}/status",
        json={"order_status": "confirmed"},
    )
    assert restored.status_code == 200
    assert all(task["status"] == "confirmed" for task in restored.json()["tasks"])
    assert (
        client.patch(
            f"/api/admin/orders/{created['id']}/status",
            json={"order_status": "completed"},
        ).status_code
        == 409
    )


def test_execution_history_blocks_structural_rebuild_without_data_loss(
    order_api_context: OrderApiContext,
) -> None:
    client = order_api_context.client
    customer, cats = create_customer_with_cats(client)
    payload = order_payload(customer["id"], [cat["id"] for cat in cats])
    created = client.post("/api/admin/orders", json=payload).json()

    with order_api_context.session_factory.begin() as session:
        task = session.scalar(
            select(Task).where(Task.order_id == created["id"]).order_by(Task.id)
        )
        assert task is not None
        task.status = TaskStatus.IN_PROGRESS
        task.started_at = datetime(2030, 10, 1, 9, 0, tzinfo=timezone.utc)
        task.items[0].completed = True
        task.photos.append(TaskPhoto(file_url="/uploads/tests/not-a-real-photo.jpg"))

    blocked_payload = {**payload, "end_date": "2030-10-08"}
    response = client.put(
        f"/api/admin/orders/{created['id']}",
        json=blocked_payload,
    )

    assert response.status_code == 409
    with order_api_context.session_factory() as session:
        assert session.scalar(select(func.count(Task.id))) == 7
        assert session.scalar(select(func.count(TaskItem.id))) == 28
        assert session.scalar(select(func.count(TaskPhoto.id))) == 1


def test_order_validation_and_atomic_failure_boundaries(
    order_api_context: OrderApiContext,
) -> None:
    client = order_api_context.client
    first_customer, first_cats = create_customer_with_cats(client)
    second_customer, second_cats = create_customer_with_cats(
        client,
        name="另一位订单测试客户（虚构）",
        cat_names=("另一位客户的测试猫",),
    )
    base = order_payload(first_customer["id"], [first_cats[0]["id"]])

    invalid_payloads = [
        {**base, "cat_ids": []},
        {**base, "cat_ids": [first_cats[0]["id"], first_cats[0]["id"]]},
        {**base, "cat_ids": [second_cats[0]["id"]]},
        {**base, "service_items": []},
        {**base, "start_date": "2030-10-08", "end_date": "2030-10-01"},
        {**base, "visits_per_day": 11},
        {**base, "stairs_fee": "3.00"},
        {**base, "order_status": "completed"},
    ]
    for invalid in invalid_payloads:
        assert client.post("/api/admin/orders", json=invalid).status_code == 422

    stop_response = client.patch(
        f"/api/admin/customers/{first_customer['id']}/cats/{first_cats[0]['id']}",
        json={"is_active": False},
    )
    assert stop_response.status_code == 200
    assert client.post("/api/admin/orders", json=base).status_code == 422

    with order_api_context.session_factory() as session:
        assert session.scalar(select(func.count(Order.id))) == 0
        assert session.scalar(select(func.count(Task.id))) == 0

    assert client.get("/api/admin/orders/999999").status_code == 404
    assert second_customer["id"] != first_customer["id"]


def test_form_options_exclude_inactive_cats_and_customer_change_with_payment(
    order_api_context: OrderApiContext,
) -> None:
    client = order_api_context.client
    first_customer, first_cats = create_customer_with_cats(client)
    second_customer, second_cats = create_customer_with_cats(
        client,
        name="收款边界第二位客户（虚构）",
        cat_names=("收款边界第二位测试猫",),
    )
    client.patch(
        f"/api/admin/customers/{first_customer['id']}/cats/{first_cats[1]['id']}",
        json={"is_active": False},
    )

    options_response = client.get("/api/admin/orders/form-options")
    assert options_response.status_code == 200
    first_option = next(
        option
        for option in options_response.json()["customers"]
        if option["id"] == first_customer["id"]
    )
    assert [cat["id"] for cat in first_option["cats"]] == [first_cats[0]["id"]]
    assert {"id", "name", "community", "address", "phone", "cats"} <= set(first_option)

    payload = order_payload(first_customer["id"], [first_cats[0]["id"]])
    created = client.post("/api/admin/orders", json=payload).json()
    with order_api_context.session_factory.begin() as session:
        session.add(
            Payment(
                order_id=created["id"],
                customer_id=first_customer["id"],
                amount=10,
                payment_method=PaymentMethod.CASH,
            )
        )

    changed_customer_payload = order_payload(
        second_customer["id"],
        [second_cats[0]["id"]],
    )
    response = client.put(
        f"/api/admin/orders/{created['id']}",
        json=changed_customer_payload,
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "订单已有收款记录，不能更换客户"


def test_simple_order_syncs_customer_profile_and_creates_non_contiguous_tasks(
    order_api_context: OrderApiContext,
) -> None:
    client = order_api_context.client

    response = client.post("/api/admin/orders", json=simple_order_payload())

    assert response.status_code == 201
    order = response.json()
    assert order["customer"]["name"] == "日历订单新客户（虚构）"
    assert order["cat_count"] == 3
    assert order["cats"] == []
    assert order["pricing_mode"] == "per_visit"
    assert order["unit_price"] == "42.00"
    assert order["total_amount"] == "126.00"
    assert order["order_status"] == "confirmed"
    assert [entry["service_date"] for entry in order["service_schedule"]] == [
        "2032-03-02",
        "2032-03-05",
        "2032-03-09",
    ]
    assert [task["service_date"] for task in order["tasks"]] == [
        "2032-03-02",
        "2032-03-05",
        "2032-03-09",
    ]
    assert all(task["status"] == "confirmed" for task in order["tasks"])

    reused = client.post(
        "/api/admin/orders",
        json=simple_order_payload(service_dates=["2032-04-01"]),
    )
    assert reused.status_code == 201
    assert reused.json()["customer"]["id"] is not None
    assert order["customer"]["id"] is not None
    assert reused.json()["customer"]["id"] != order["customer"]["id"]
    with order_api_context.session_factory() as session:
        assert session.scalar(select(func.count(Customer.id))) == 2


def test_simple_order_requires_selection_for_ambiguous_match_and_rejects_invalid_schedule(
    order_api_context: OrderApiContext,
) -> None:
    client = order_api_context.client
    first, _ = create_customer_with_cats(client, name="同名客户（虚构）", cat_names=("甲",))
    second, _ = create_customer_with_cats(client, name="同名客户（虚构）", cat_names=("乙",))
    for customer in (first, second):
        assert client.patch(
            f"/api/admin/customers/{customer['id']}",
            json={"phone": "AMBIGUOUS-13800138000"},
        ).status_code == 200

    ambiguous = client.post(
        "/api/admin/orders",
        json=simple_order_payload(
            customer_name=None,
            service_contact={"name": "同名客户（虚构）", "phone": "13800138000"},
        ),
    )
    assert ambiguous.status_code == 409
    assert ambiguous.json()["detail"]["code"] == "customer_match_ambiguous"

    invalid_payloads = [
        simple_order_payload(service_dates=[]),
        simple_order_payload(service_dates=["2032-03-02", "2032-03-02"]),
        simple_order_payload(cat_count=51),
        simple_order_payload(service_items=[]),
    ]
    for payload in invalid_payloads:
        assert client.post("/api/admin/orders", json=payload).status_code == 422


def test_paid_simple_order_rejects_repricing(
    order_api_context: OrderApiContext,
) -> None:
    client = order_api_context.client
    customer, _ = create_customer_with_cats(client, cat_names=("历史猫",))
    created = client.post(
        "/api/admin/orders",
        json=simple_order_payload(
            customer_name=None,
            customer_id=customer["id"],
            service_dates=["2032-05-01", "2032-05-03"],
            unit_price="50.00",
        ),
    ).json()
    with order_api_context.session_factory.begin() as session:
        order = session.get(Order, created["id"])
        assert order is not None
        order.paid_amount = 100
        order.payment_status = OrderPaymentStatus.PAID
        session.add(
            Payment(
                order_id=order.id,
                customer_id=customer["id"],
                amount=100,
                payment_method=PaymentMethod.CASH,
            )
        )

    response = client.patch(
        f"/api/admin/orders/{created['id']}",
        json={"unit_price": "20.00"},
    )

    assert response.status_code == 409
    assert "已有收款" in response.json()["detail"]


def test_unstarted_unpaid_order_can_be_permanently_deleted(
    order_api_context: OrderApiContext,
) -> None:
    client = order_api_context.client
    created = client.post(
        "/api/admin/orders",
        json=simple_order_payload(service_dates=["2032-06-01"]),
    ).json()

    assert created["deletable"] is True
    assert created["delete_block_reason"] is None
    response = client.delete(f"/api/admin/orders/{created['id']}")

    assert response.status_code == 204
    assert client.get(f"/api/admin/orders/{created['id']}").status_code == 404
    with order_api_context.session_factory() as session:
        assert session.scalar(select(func.count(Task.id))) == 0
        assert session.scalar(select(func.count(TaskItem.id))) == 0


def test_payment_history_blocks_order_delete_and_explains_cancellation(
    order_api_context: OrderApiContext,
) -> None:
    client = order_api_context.client
    created = client.post(
        "/api/admin/orders",
        json=simple_order_payload(service_dates=["2032-07-01"]),
    ).json()
    with order_api_context.session_factory.begin() as session:
        session.add(
            Payment(
                order_id=created["id"],
                customer_id=None,
                amount=10,
                payment_method=PaymentMethod.CASH,
            )
        )

    detail = client.get(f"/api/admin/orders/{created['id']}").json()
    assert detail["deletable"] is False
    assert "收款流水" in detail["delete_block_reason"]
    response = client.delete(f"/api/admin/orders/{created['id']}")

    assert response.status_code == 409
    assert "只能取消" in response.json()["detail"]
    assert client.get(f"/api/admin/orders/{created['id']}").status_code == 200


@pytest.mark.parametrize(
    "history_kind",
    ["started_at", "completed_at", "completed_item", "photo", "in_progress"],
)
def test_each_execution_history_signal_blocks_order_delete(
    order_api_context: OrderApiContext,
    history_kind: str,
) -> None:
    client = order_api_context.client
    created = client.post(
        "/api/admin/orders",
        json=simple_order_payload(service_dates=["2032-08-01"]),
    ).json()
    with order_api_context.session_factory.begin() as session:
        task = session.scalar(select(Task).where(Task.order_id == created["id"]))
        assert task is not None
        if history_kind == "started_at":
            task.started_at = datetime(2032, 8, 1, 9, 0, tzinfo=timezone.utc)
        elif history_kind == "completed_at":
            task.completed_at = datetime(2032, 8, 1, 10, 0, tzinfo=timezone.utc)
        elif history_kind == "completed_item":
            task.items[0].completed = True
        elif history_kind == "photo":
            task.photos.append(TaskPhoto(file_url="/uploads/tests/delete-block.jpg"))
        else:
            task.status = TaskStatus.IN_PROGRESS

    response = client.delete(f"/api/admin/orders/{created['id']}")

    assert response.status_code == 409
    assert "只能取消" in response.json()["detail"]
    assert client.get(f"/api/admin/orders/{created['id']}").json()["deletable"] is False
