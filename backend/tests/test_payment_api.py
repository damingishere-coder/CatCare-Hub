from collections.abc import Generator
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.db.session import build_engine, get_db
from app.main import app
from app.models import Order, Payment
from app.models.enums import (
    OrderPaymentStatus,
    OrderStatus,
    PaymentMethod,
    PaymentRecordStatus,
)
from app.services.payments import payment_revision


@dataclass(frozen=True)
class PaymentApiContext:
    client: TestClient
    session_factory: sessionmaker[Session]


@pytest.fixture
def payment_api_context(
    migrated_database_url: str,
) -> Generator[PaymentApiContext, None, None]:
    engine = build_engine(migrated_database_url)
    testing_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db() -> Generator[Session, None, None]:
        with testing_session() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            yield PaymentApiContext(client=client, session_factory=testing_session)
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def create_payment_order(
    client: TestClient,
    *,
    name: str,
    start_date: str = "2035-10-06",
    end_date: str = "2035-10-06",
) -> tuple[dict, dict]:
    customer_response = client.post(
        "/api/admin/customers",
        json={
            "name": name,
            "phone": "FAKE-P8-PHONE",
            "wechat_name": "P8 虚构微信",
            "community": "P8 虚构小区",
            "address": "P8 不对应真实地点的地址",
            "access_method": "P8 虚构门禁",
            "access_info": "P8 虚构入户说明",
            "key_status": "待取",
            "key_code": "FAKE-P8-KEY",
            "notes": "P8 不应进入收款页的客户备注",
        },
    )
    assert customer_response.status_code == 201
    customer = customer_response.json()
    cat_response = client.post(
        f"/api/admin/customers/{customer['id']}/cats",
        json={
            "name": f"{name}的虚构猫咪",
            "service_notes": "P8 不应进入收款页的猫咪备注",
        },
    )
    assert cat_response.status_code == 201
    cat = cat_response.json()
    order_response = client.post(
        "/api/admin/orders",
        json={
            "customer_id": customer["id"],
            "cat_ids": [cat["id"]],
            "start_date": start_date,
            "end_date": end_date,
            "visits_per_day": 1,
            "service_items": ["feed"],
            "base_price": "30.00",
            "stairs_fee": "0.00",
            "other_fee": "0.00",
            "settlement_mode": "order_total",
            "order_status": "confirmed",
            "notes": "P8 不应进入收款页的订单备注",
        },
    )
    assert order_response.status_code == 201
    return customer, order_response.json()


def test_payments_empty_state_and_date_validation(
    payment_api_context: PaymentApiContext,
) -> None:
    response = payment_api_context.client.get(
        "/api/admin/payments",
        params={"date": "2035-10-06"},
    )
    assert response.status_code == 200
    assert response.json() == {
        "business_date": "2035-10-06",
        "month_start": "2035-10-01",
        "metrics": {
            "today_income": "0.00",
            "pending_order_count": 0,
            "month_income": "0.00",
            "completed_order_count": 0,
        },
        "receivables": [],
        "records": [],
    }
    assert payment_api_context.client.get(
        "/api/admin/payments",
        params={"date": "invalid"},
    ).status_code == 422


def test_payment_summary_boundaries_records_and_privacy(
    payment_api_context: PaymentApiContext,
) -> None:
    client = payment_api_context.client
    customer, order_payload = create_payment_order(
        client,
        name="P8 汇总客户（虚构）",
    )
    with payment_api_context.session_factory.begin() as session:
        order = session.get(Order, order_payload["id"])
        assert order is not None
        order.order_status = OrderStatus.COMPLETED
        session.add_all(
            [
                Payment(
                    order_id=order.id,
                    customer_id=customer["id"],
                    amount=Decimal("10.00"),
                    payment_method=PaymentMethod.WECHAT,
                    payment_status=PaymentRecordStatus.COMPLETED,
                    paid_at=datetime(2035, 10, 5, 16, 0, tzinfo=timezone.utc),
                    notes="P8-PAYMENT-PRIVATE-NOTE",
                ),
                Payment(
                    order_id=order.id,
                    customer_id=customer["id"],
                    amount=Decimal("20.00"),
                    payment_method=PaymentMethod.ALIPAY,
                    payment_status=PaymentRecordStatus.COMPLETED,
                    paid_at=datetime(2035, 10, 6, 15, 59, 59, tzinfo=timezone.utc),
                ),
                Payment(
                    order_id=order.id,
                    customer_id=customer["id"],
                    amount=Decimal("30.00"),
                    payment_method=PaymentMethod.CASH,
                    payment_status=PaymentRecordStatus.COMPLETED,
                    paid_at=datetime(2035, 10, 6, 16, 0, tzinfo=timezone.utc),
                ),
                Payment(
                    order_id=order.id,
                    customer_id=customer["id"],
                    amount=Decimal("40.00"),
                    payment_method=PaymentMethod.OTHER,
                    payment_status=PaymentRecordStatus.PENDING,
                    paid_at=None,
                ),
                Payment(
                    order_id=order.id,
                    customer_id=customer["id"],
                    amount=Decimal("50.00"),
                    payment_method=PaymentMethod.OTHER,
                    payment_status=PaymentRecordStatus.REFUNDED,
                    paid_at=None,
                ),
                Payment(
                    order_id=order.id,
                    customer_id=customer["id"],
                    amount=Decimal("60.00"),
                    payment_method=PaymentMethod.OTHER,
                    payment_status=PaymentRecordStatus.COMPLETED,
                    paid_at=datetime(2035, 9, 30, 15, 59, 59, tzinfo=timezone.utc),
                ),
            ]
        )

    response = client.get(
        "/api/admin/payments",
        params={"date": "2035-10-06"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["metrics"] == {
        "today_income": "30.00",
        "pending_order_count": 1,
        "month_income": "60.00",
        "completed_order_count": 1,
    }
    assert len(payload["receivables"]) == 1
    assert payload["receivables"][0]["order_id"] == order_payload["id"]
    assert len(payload["receivables"][0]["revision"]) == 64
    assert [record["amount"] for record in payload["records"][:3]] == [
        "30.00",
        "20.00",
        "10.00",
    ]
    assert {record["payment_status"] for record in payload["records"]} == {
        "pending",
        "completed",
        "refunded",
    }
    body = response.text
    for forbidden in (
        "FAKE-P8-PHONE",
        "P8 虚构微信",
        "P8 虚构门禁",
        "FAKE-P8-KEY",
        "P8 不应进入收款页的客户备注",
        "P8 不应进入收款页的猫咪备注",
        "P8 不应进入收款页的订单备注",
        "P8-PAYMENT-PRIVATE-NOTE",
    ):
        assert forbidden not in body


def test_register_partial_and_final_payment_updates_order_and_dashboard(
    payment_api_context: PaymentApiContext,
) -> None:
    client = payment_api_context.client
    customer, order = create_payment_order(
        client,
        name="P8 登记客户（虚构）",
    )
    with payment_api_context.session_factory.begin() as session:
        completed_order = session.get(Order, order["id"])
        assert completed_order is not None
        completed_order.order_status = OrderStatus.COMPLETED
    overview = client.get(
        "/api/admin/payments",
        params={"date": "2035-10-06"},
    ).json()
    original_revision = overview["receivables"][0]["revision"]

    first = client.post(
        "/api/admin/payments",
        json={
            "order_id": order["id"],
            "amount": "10.00",
            "payment_method": "wechat",
            "paid_at": "2035-10-06T09:15:00+08:00",
            "notes": "P8 虚构首次收款备注",
            "expected_revision": original_revision,
        },
    )
    assert first.status_code == 201
    first_payload = first.json()
    assert first_payload["payment"]["customer_name"] == customer["name"]
    assert first_payload["payment"]["paid_at"] == "2035-10-06T01:15:00Z"
    assert first_payload["order"]["paid_amount"] == "10.00"
    assert first_payload["order"]["due_amount"] == "20.00"
    assert first_payload["order"]["payment_status"] == "partial"
    assert first_payload["order"]["revision"] != original_revision

    stale = client.post(
        "/api/admin/payments",
        json={
            "order_id": order["id"],
            "amount": "20.00",
            "payment_method": "cash",
            "paid_at": "2035-10-06T10:00:00+08:00",
            "expected_revision": original_revision,
        },
    )
    assert stale.status_code == 409

    final = client.post(
        "/api/admin/payments",
        json={
            "order_id": order["id"],
            "amount": "20.00",
            "payment_method": "cash",
            "paid_at": "2035-10-06T10:00:00+08:00",
            "expected_revision": first_payload["order"]["revision"],
        },
    )
    assert final.status_code == 201
    assert final.json()["order"]["paid_amount"] == "30.00"
    assert final.json()["order"]["due_amount"] == "0.00"
    assert final.json()["order"]["payment_status"] == "paid"

    refreshed = client.get(
        "/api/admin/payments",
        params={"date": "2035-10-06"},
    ).json()
    assert refreshed["metrics"]["today_income"] == "30.00"
    assert refreshed["metrics"]["month_income"] == "30.00"
    assert refreshed["metrics"]["pending_order_count"] == 0
    assert refreshed["metrics"]["completed_order_count"] == 1
    assert refreshed["receivables"] == []
    assert len(refreshed["records"]) == 2
    order_detail = client.get(f"/api/admin/orders/{order['id']}").json()
    assert order_detail["paid_amount"] == "30.00"
    assert order_detail["due_amount"] == "0.00"
    assert order_detail["payment_status"] == "paid"
    dashboard = client.get(
        "/api/admin/dashboard",
        params={"date": "2035-10-06"},
    ).json()
    assert dashboard["metrics"]["pending_payment_count"] == 0
    assert dashboard["metrics"]["month_income"] == "30.00"

    with payment_api_context.session_factory() as session:
        records = list(
            session.scalars(
                select(Payment).where(Payment.order_id == order["id"])
            )
        )
        assert len(records) == 2
        assert {record.customer_id for record in records} == {customer["id"]}
        assert {record.payment_status for record in records} == {
            PaymentRecordStatus.COMPLETED
        }


def test_register_payment_rejects_invalid_or_ineligible_writes_atomically(
    payment_api_context: PaymentApiContext,
) -> None:
    client = payment_api_context.client
    _, order = create_payment_order(client, name="P8 边界客户（虚构）")
    revision = client.get(
        "/api/admin/payments",
        params={"date": "2035-10-06"},
    ).json()["receivables"][0]["revision"]
    base_payload = {
        "order_id": order["id"],
        "payment_method": "alipay",
        "paid_at": "2035-10-06T09:00:00+08:00",
        "expected_revision": revision,
    }
    assert client.post(
        "/api/admin/payments",
        json={**base_payload, "amount": "30.01"},
    ).status_code == 409
    assert client.post(
        "/api/admin/payments",
        json={**base_payload, "amount": "0.00"},
    ).status_code == 422
    assert client.post(
        "/api/admin/payments",
        json={**base_payload, "amount": "1.001"},
    ).status_code == 422
    assert client.post(
        "/api/admin/payments",
        json={**base_payload, "amount": "1.00", "paid_at": "2035-10-06T09:00:00"},
    ).status_code == 422
    assert client.post(
        "/api/admin/payments",
        json={**base_payload, "order_id": 999999, "amount": "1.00"},
    ).status_code == 404

    cancelled_customer, cancelled_order = create_payment_order(
        client,
        name="P8 取消客户（虚构）",
        start_date="2035-10-07",
        end_date="2035-10-07",
    )
    assert cancelled_customer
    assert client.patch(
        f"/api/admin/orders/{cancelled_order['id']}/status",
        json={"order_status": "cancelled"},
    ).status_code == 200
    with payment_api_context.session_factory() as session:
        cancelled_model = session.get(Order, cancelled_order["id"])
        assert cancelled_model is not None
        cancelled_revision = payment_revision(cancelled_model)
    assert client.post(
        "/api/admin/payments",
        json={
            **base_payload,
            "order_id": cancelled_order["id"],
            "amount": "1.00",
            "expected_revision": cancelled_revision,
        },
    ).status_code == 409

    _, refunded_order = create_payment_order(
        client,
        name="P8 退款客户（虚构）",
        start_date="2035-10-08",
        end_date="2035-10-08",
    )
    _, paid_order = create_payment_order(
        client,
        name="P8 结清客户（虚构）",
        start_date="2035-10-09",
        end_date="2035-10-09",
    )
    with payment_api_context.session_factory.begin() as session:
        refunded_model = session.get(Order, refunded_order["id"])
        paid_model = session.get(Order, paid_order["id"])
        assert refunded_model is not None and paid_model is not None
        refunded_model.payment_status = OrderPaymentStatus.REFUNDED
        paid_model.paid_amount = paid_model.total_amount
        paid_model.payment_status = OrderPaymentStatus.PAID
    with payment_api_context.session_factory() as session:
        refunded_model = session.get(Order, refunded_order["id"])
        paid_model = session.get(Order, paid_order["id"])
        assert refunded_model is not None and paid_model is not None
        refunded_revision = payment_revision(refunded_model)
        paid_revision = payment_revision(paid_model)
    assert client.post(
        "/api/admin/payments",
        json={
            **base_payload,
            "order_id": refunded_order["id"],
            "amount": "1.00",
            "expected_revision": refunded_revision,
        },
    ).status_code == 409
    assert client.post(
        "/api/admin/payments",
        json={
            **base_payload,
            "order_id": paid_order["id"],
            "amount": "1.00",
            "expected_revision": paid_revision,
        },
    ).status_code == 409

    with payment_api_context.session_factory() as session:
        assert session.scalar(select(func.count(Payment.id))) == 0
        original = session.get(Order, order["id"])
        assert original is not None
        assert original.paid_amount == Decimal("0.00")
        assert original.payment_status is OrderPaymentStatus.UNPAID
