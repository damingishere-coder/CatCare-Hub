from collections.abc import Generator
from dataclasses import dataclass, field
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.db.seed import seed_database
from app.db.session import build_engine, get_db
from app.main import app
from app.maps import GeoPoint, GeocodeResult, MapServices
from app.maps.factory import UnavailableMapProvider, get_map_services
from app.models import (
    Cat,
    Customer,
    Order,
    Payment,
    SystemFlag,
    Task,
    TaskItem,
    TaskItemType,
    TaskStatus,
)
from app.services.demo_data import DEMO_CLEARED_FLAG


@dataclass
class SequenceGeocoder:
    results: list[GeocodeResult | None]
    calls: list[str] = field(default_factory=list)

    def geocode(self, address: str) -> GeocodeResult | None:
        self.calls.append(address)
        return self.results[min(len(self.calls) - 1, len(self.results) - 1)]


@dataclass(frozen=True)
class P18Context:
    client: TestClient
    session_factory: sessionmaker[Session]
    geocoder: SequenceGeocoder
    database_url: str


@pytest.fixture
def p18_context(migrated_database_url: str) -> Generator[P18Context, None, None]:
    engine = build_engine(migrated_database_url)
    testing_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    geocoder = SequenceGeocoder(
        [
            GeocodeResult(GeoPoint(30.1234567, 120.1234567), "深圳市", "龙岗区", "440307", "门牌号"),
            GeocodeResult(GeoPoint(30.2234567, 120.2234567), "深圳市", "龙岗区", "440307", "门牌号"),
            GeocodeResult(GeoPoint(30.3234567, 120.3234567), "深圳市", "龙岗区", "440307", "门牌号"),
        ]
    )
    unavailable = UnavailableMapProvider("test", "路线不在本测试范围")
    services = MapServices(unavailable, geocoder, unavailable, unavailable)

    def override_get_db() -> Generator[Session, None, None]:
        with testing_session() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_map_services] = lambda: services
    try:
        with TestClient(app) as client:
            yield P18Context(client, testing_session, geocoder, migrated_database_url)
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_map_services, None)
        engine.dispose()


def direct_order_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "service_contact": {
            "name": "P18 订单客户（虚构）",
            "phone": "13800138018",
            "wechat_name": "P18-wechat",
            "address": "P18 虚构路 18 号",
            "access_method": "钥匙",
            "key_status": "已取",
            "key_code": "P18-KEY",
        },
        "cat_snapshot": [],
        "cat_count": 2,
        "service_dates": ["2038-08-26", "2038-08-27"],
        "service_items": ["feed", "water", "litter", "photo"],
        "unit_price": "30.00",
        "settlement_mode": "daily",
        "amount_adjustment": {
            "type": "none",
            "amount": "0.00",
            "reason": None,
            "service_date": None,
        },
        "notes": None,
    }
    payload.update(overrides)
    return payload


def test_direct_order_matches_restores_and_only_fills_empty_customer_fields(
    p18_context: P18Context,
) -> None:
    client = p18_context.client
    created = client.post(
        "/api/admin/customers",
        json={
            "name": "原档案名称",
            "phone": "138-0013-8018",
            "address": "P18 虚构路 18 号",
            "access_method": "门卡",
        },
    ).json()
    assert client.patch(
        f"/api/admin/customers/{created['id']}/archive", json={"archived": True}
    ).status_code == 200

    response = client.post("/api/admin/orders", json=direct_order_payload())
    assert response.status_code == 201
    order = response.json()
    assert order["source_customer_id"] == created["id"]
    assert order["customer_resolution"] == "matched_phone"
    assert order["pending_cat_profile_count"] == 2
    assert order["cats"] == []
    assert order["route_geocode_status"] == "resolved"
    assert p18_context.geocoder.calls == ["深圳市龙岗区P18 虚构路 18 号"]

    profile = client.get(f"/api/admin/customers/{created['id']}").json()
    assert profile["archived_at"] is None
    assert profile["wechat_name"] == "P18-wechat"
    assert profile["access_method"] == "门卡"
    assert profile["pending_cat_profile_count"] == 2
    assert profile["cats"] == []
    with p18_context.session_factory() as session:
        assert session.scalar(select(func.count(Cat.id))) == 0
        tasks = list(session.scalars(select(Task).where(Task.order_id == order["id"])))
        assert {task.customer_id for task in tasks} == {created["id"]}
        customer = session.get(Customer, created["id"])
        assert customer is not None
        assert str(customer.latitude) == "30.1234567"


def test_order_geocoding_excludes_unit_and_room_and_their_edits_keep_coordinates(
    p18_context: P18Context,
) -> None:
    client = p18_context.client
    created = client.post(
        "/api/admin/orders",
        json=direct_order_payload(
            service_contact={
                "name": "P19 地址隐私客户（虚构）",
                "community": "P19 虚构花园",
                "address": "P19 虚构路 19 号",
                "building": "3栋",
                "unit": "2单元",
                "room": "1901室",
            }
        ),
    )
    assert created.status_code == 201
    order = created.json()
    assert p18_context.geocoder.calls == [
        "深圳市龙岗区P19 虚构路 19 号 P19 虚构花园 3栋"
    ]
    assert "2单元" not in p18_context.geocoder.calls[0]
    assert "1901室" not in p18_context.geocoder.calls[0]

    updated_contact = {
        **order["service_contact"],
        "unit": "5单元",
        "room": "2502室",
    }
    patched = client.patch(
        f"/api/admin/orders/{order['id']}",
        json={"service_contact": updated_contact},
    )
    assert patched.status_code == 200
    assert patched.json()["service_contact"]["unit"] == "5单元"
    assert patched.json()["service_contact"]["room"] == "2502室"
    assert patched.json()["route_geocode_status"] == "resolved"
    assert p18_context.geocoder.calls == [
        "深圳市龙岗区P19 虚构路 19 号 P19 虚构花园 3栋"
    ]


def test_legacy_room_text_is_removed_from_the_virtual_geocode_address(
    p18_context: P18Context,
) -> None:
    created = p18_context.client.post(
        "/api/admin/orders",
        json=direct_order_payload(
            service_contact={
                "name": "P20 旧地址客户（虚构）",
                "address": "长坑三巷21号 2单元 1312房",
            }
        ),
    )

    assert created.status_code == 201
    assert created.json()["service_contact"]["address"] == "长坑三巷21号 2单元 1312房"
    assert p18_context.geocoder.calls == ["深圳市龙岗区长坑三巷21号"]


def test_daily_adjustment_partial_payments_and_financial_lock(
    p18_context: P18Context,
) -> None:
    client = p18_context.client
    response = client.post(
        "/api/admin/orders",
        json=direct_order_payload(
            service_contact={
                "name": "P18 日结客户（虚构）",
                "phone": "13800138019",
                "address": "P18 虚构路 19 号",
            },
            amount_adjustment={
                "type": "surcharge",
                "amount": "5.00",
                "reason": "节假日加收",
                "service_date": "2038-08-27",
            },
        ),
    )
    assert response.status_code == 201
    order = response.json()
    assert order["total_amount"] == "65.00"
    assert [item["expected_amount"] for item in order["daily_receivables"]] == [
        "30.00",
        "35.00",
    ]

    invalid_discount = client.patch(
        f"/api/admin/orders/{order['id']}",
        json={
            "unit_price": "20.00",
            "amount_adjustment": {
                "type": "discount",
                "amount": "25.00",
                "reason": "不得把当日金额减为负数",
                "service_date": "2038-08-27",
            },
        },
    )
    assert invalid_discount.status_code == 422
    assert client.get(f"/api/admin/orders/{order['id']}").json()["total_amount"] == "65.00"

    overview = client.get("/api/admin/payments", params={"date": "2038-08-26"}).json()
    assert [item["service_date"] for item in overview["receivables"]] == [
        "2038-08-26",
        "2038-08-27",
    ]
    first_day = overview["receivables"][0]
    paid = client.post(
        "/api/admin/payments",
        json={
            "order_id": order["id"],
            "service_date": "2038-08-26",
            "amount": "10.00",
            "payment_method": "wechat",
            "paid_at": "2038-08-26T09:00:00+08:00",
            "notes": None,
            "expected_revision": first_day["revision"],
        },
    )
    assert paid.status_code == 201
    assert paid.json()["order"]["due_amount"] == "20.00"

    refreshed = client.get("/api/admin/payments", params={"date": "2038-08-26"}).json()
    first_day = next(
        item for item in refreshed["receivables"] if item["service_date"] == "2038-08-26"
    )
    overpay = client.post(
        "/api/admin/payments",
        json={
            "order_id": order["id"],
            "service_date": "2038-08-26",
            "amount": "20.01",
            "payment_method": "cash",
            "paid_at": "2038-08-26T10:00:00+08:00",
            "notes": None,
            "expected_revision": first_day["revision"],
        },
    )
    assert overpay.status_code == 409
    missing_date = client.post(
        "/api/admin/payments",
        json={
            "order_id": order["id"],
            "service_date": None,
            "amount": "1.00",
            "payment_method": "cash",
            "paid_at": "2038-08-26T10:00:00+08:00",
            "notes": None,
            "expected_revision": first_day["revision"],
        },
    )
    assert missing_date.status_code == 422
    locked = client.patch(
        f"/api/admin/orders/{order['id']}", json={"settlement_mode": "order_total"}
    )
    assert locked.status_code == 409

    with p18_context.session_factory() as session:
        payments = list(session.scalars(select(Payment).where(Payment.order_id == order["id"])))
        assert [payment.service_date.isoformat() for payment in payments] == ["2038-08-26"]


def test_failed_auto_geocode_does_not_rollback_and_retry_resolves(
    p18_context: P18Context,
) -> None:
    p18_context.geocoder.results[:] = [
        None,
        GeocodeResult(GeoPoint(30.5, 120.5), "深圳市", "龙岗区", "440307", "门牌号"),
    ]
    created = p18_context.client.post(
        "/api/admin/orders",
        json=direct_order_payload(
            service_contact={
                "name": "P18 定位重试客户（虚构）",
                "phone": "13800138020",
                "address": "P18 虚构路 20 号",
            }
        ),
    )
    assert created.status_code == 201
    order = created.json()
    assert order["route_geocode_status"] == "failed"
    assert order["task_count"] == 2

    retried = p18_context.client.post(f"/api/admin/orders/{order['id']}/geocode")
    assert retried.status_code == 200
    assert retried.json()["route_geocode_status"] == "resolved"
    assert p18_context.geocoder.calls == [
        "深圳市龙岗区P18 虚构路 20 号",
        "深圳市龙岗区P18 虚构路 20 号",
    ]


def test_failed_geocode_clears_stale_order_and_unexecuted_task_coordinates(
    p18_context: P18Context,
) -> None:
    created = p18_context.client.post(
        "/api/admin/orders",
        json=direct_order_payload(service_dates=["2038-09-01", "2038-09-02"]),
    ).json()
    with p18_context.session_factory.begin() as session:
        order = session.get(Order, created["id"])
        assert order is not None
        order.route_latitude = Decimal("22.5000000")
        order.route_longitude = Decimal("114.0000000")
        order.route_geocode_status = "resolved"
        order.route_geocode_fingerprint = "f" * 64
        order.route_geocode_adcode = "440307"
        order.route_geocode_level = "门牌号"
        tasks = list(
            session.scalars(
                select(Task).where(Task.order_id == order.id).order_by(Task.id)
            )
        )
        for task in tasks:
            task.planned_lat = Decimal("22.5000000")
            task.planned_lng = Decimal("114.0000000")
        tasks[1].status = TaskStatus.IN_PROGRESS

    p18_context.geocoder.results[:] = [None]
    response = p18_context.client.post(
        f"/api/admin/orders/{created['id']}/geocode"
    )

    assert response.status_code == 200
    failed = response.json()
    assert failed["route_geocode_status"] == "failed"
    with p18_context.session_factory() as session:
        order = session.get(Order, created["id"])
        assert order is not None
        assert order.route_latitude is None
        assert order.route_longitude is None
        assert order.route_geocode_fingerprint is None
        assert order.route_geocode_adcode is None
        assert order.route_geocode_level is None
        tasks = list(
            session.scalars(
                select(Task).where(Task.order_id == order.id).order_by(Task.id)
            )
        )
        assert tasks[0].planned_lat is None and tasks[0].planned_lng is None
        assert tasks[1].planned_lat == Decimal("22.5000000")
        assert tasks[1].planned_lng == Decimal("114.0000000")


def test_demo_cleanup_is_exact_and_seed_tombstone_prevents_recreation(
    p18_context: P18Context,
) -> None:
    assert seed_database(p18_context.database_url) is True
    with p18_context.session_factory() as session:
        seeded_order = session.scalar(
            select(Order).where(Order.seed_source == "catcare-demo-seed-v1")
        )
        assert seeded_order is not None
        assert all(item["source_cat_id"] is not None for item in seeded_order.cat_snapshot)
    unrelated = p18_context.client.post(
        "/api/admin/customers", json={"name": "P18 保留客户（虚构）"}
    ).json()
    preview = p18_context.client.get("/api/admin/settings/demo-data").json()
    assert preview["counts"] == {
        "customers": 1,
        "cats": 2,
        "orders": 1,
        "tasks": 3,
        "payments": 1,
    }

    cleared = p18_context.client.post(
        "/api/admin/settings/demo-data/clear",
        json={
            "system_key": "catcare-demo-seed-v1",
            "confirmation": "永久清除演示数据",
        },
    )
    assert cleared.status_code == 200
    assert cleared.json()["cleared"] is True
    assert seed_database(p18_context.database_url) is False

    with p18_context.session_factory() as session:
        assert session.get(Customer, unrelated["id"]) is not None
        assert session.get(SystemFlag, DEMO_CLEARED_FLAG) is not None
        assert session.scalar(
            select(func.count(Customer.id)).where(
                Customer.system_key == "catcare-demo-seed-v1"
            )
        ) == 0
        assert session.scalar(select(func.count(Order.id))) == 0


def test_demo_cleanup_fails_closed_when_unmarked_data_is_mixed_in(
    p18_context: P18Context,
) -> None:
    assert seed_database(p18_context.database_url) is True
    with p18_context.session_factory.begin() as session:
        task = session.scalar(
            select(Task).where(Task.seed_source == "catcare-demo-seed-v1")
        )
        assert task is not None
        session.add(
            TaskItem(
                task_id=task.id,
                item_type=TaskItemType.OTHER,
                required=False,
            )
        )

    before = {}
    with p18_context.session_factory() as session:
        for model in (Customer, Cat, Order, Task, Payment):
            before[model] = session.scalar(select(func.count(model.id)))

    response = p18_context.client.post(
        "/api/admin/settings/demo-data/clear",
        json={
            "system_key": "catcare-demo-seed-v1",
            "confirmation": "永久清除演示数据",
        },
    )

    assert response.status_code == 409
    with p18_context.session_factory() as session:
        for model, count in before.items():
            assert session.scalar(select(func.count(model.id))) == count
        assert session.get(SystemFlag, DEMO_CLEARED_FLAG) is None
