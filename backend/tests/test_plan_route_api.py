from collections.abc import Generator
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.db.session import build_engine, get_db
from app.main import app
from app.maps import GeoPoint, MapServices, ProviderState, RouteResult, RouteStop
from app.maps.factory import UnavailableMapProvider, get_map_services
from app.models import Customer, Order, Task
from tests.test_plan_api import PlanApiContext, create_three_task_plan


@pytest.fixture
def plan_api_context(
    migrated_database_url: str,
) -> Generator[PlanApiContext, None, None]:
    engine = build_engine(migrated_database_url)
    testing_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db() -> Generator[Session, None, None]:
        with testing_session() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            yield PlanApiContext(client=client, session_factory=testing_session)
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


@dataclass
class FakeMapProvider:
    geocode_results: list[GeoPoint | None]
    geocode_calls: list[str] = field(default_factory=list)
    route_calls: list[list[int]] = field(default_factory=list)
    home: GeoPoint = GeoPoint(latitude=30.0, longitude=120.0)

    def provider_state(self) -> ProviderState:
        return ProviderState(
            "amap",
            True,
            "GCJ-02",
            transport_mode="electrobike",
        )

    def home_point(self) -> GeoPoint:
        return self.home

    def geocode(self, address: str) -> GeoPoint | None:
        self.geocode_calls.append(address)
        return self.geocode_results[len(self.geocode_calls) - 1]

    def plan_route(self, origin: GeoPoint, stops: list[RouteStop]) -> RouteResult:
        self.route_calls.append([stop.task_id for stop in stops])
        distance = 12600 if len(self.route_calls) == 1 else 9800
        duration = 2880 if len(self.route_calls) == 1 else 2220
        return RouteResult(
            distance,
            duration,
            tuple([origin, *(stop.position for stop in stops)]),
        )

    def recommend_order(
        self,
        origin: GeoPoint,
        stops: list[RouteStop],
    ) -> list[RouteStop]:
        del origin
        return list(reversed(stops))

    def navigation_url(
        self,
        origin: GeoPoint | None,
        destination: GeoPoint,
        destination_name: str,
    ) -> str:
        del origin
        return (
            "https://uri.amap.com/navigation?"
            f"to={destination.longitude:.6f},{destination.latitude:.6f},{destination_name}"
        )


@pytest.fixture
def fake_map_provider() -> FakeMapProvider:
    provider = FakeMapProvider(
        geocode_results=[
            GeoPoint(latitude=30.10, longitude=120.10),
            GeoPoint(latitude=30.20, longitude=120.20),
            GeoPoint(latitude=30.30, longitude=120.30),
        ]
    )
    services = MapServices(provider, provider, provider, provider)
    app.dependency_overrides[get_map_services] = lambda: services
    try:
        yield provider
    finally:
        app.dependency_overrides.pop(get_map_services, None)


def test_order_save_geocodes_before_explicit_route_preview_and_adopts_recommendation(
    plan_api_context: PlanApiContext,
    fake_map_provider: FakeMapProvider,
) -> None:
    client = plan_api_context.client
    create_three_task_plan(client)
    day = client.get("/api/admin/plans/2033-10-01").json()

    local_response = client.get("/api/admin/plans/2033-10-01/route")
    assert local_response.status_code == 200
    local = local_response.json()
    assert local["transport_mode"] == "electrobike"
    assert local["provider"] == {
        "name": "amap",
        "configured": True,
        "coordinate_system": "GCJ-02",
        "message": None,
    }
    assert local["start"]["label"] == "家"
    assert len(local["markers"]) == 3
    assert local["unresolved_tasks"] == []
    assert local["current_route"] is None
    assert len(fake_map_provider.geocode_calls) == 2

    preview_response = client.post(
        "/api/admin/plans/2033-10-01/route/preview",
        json={"expected_revision": day["revision"], "geocode_missing": True},
    )
    assert preview_response.status_code == 200
    preview = preview_response.json()
    assert len(fake_map_provider.geocode_calls) == 2
    assert all("P4" not in address for address in fake_map_provider.geocode_calls)
    assert all("2 单元" not in address for address in fake_map_provider.geocode_calls)
    assert all("1602" not in address for address in fake_map_provider.geocode_calls)
    assert len(preview["markers"]) == 3
    assert all("1602" in marker["address"] for marker in preview["markers"])
    assert all("2 单元" not in marker["navigation_url"] for marker in preview["markers"])
    assert all("1602" not in marker["navigation_url"] for marker in preview["markers"])
    assert preview["unresolved_tasks"] == []
    assert preview["current_route"]["distance_meters"] == 12600
    assert preview["current_route"]["duration_seconds"] == 2880
    assert preview["recommended_route"]["distance_meters"] == 9800
    assert preview["recommended_route"]["duration_seconds"] == 2220
    assert preview["can_adopt_recommendation"] is True
    assert preview["recommended_task_ids"] == list(
        reversed([task["id"] for task in day["tasks"]])
    )
    assert preview["revision"] == day["revision"]
    assert preview["recommendation_source"] == "local"
    assert preview["recommendation_message"] == (
        "已使用本地快速推荐；最终距离、时间和路线由高德电动车路线逐段计算"
    )

    serialized = preview_response.text
    for forbidden in (
        "000-PLAN-TEST",
        "虚构门禁方式",
        "FAKE-KEY-CODE",
        "不应出现在 P4 任务响应中的虚构客户备注",
        "CATCARE_AMAP_WEB_KEY",
    ):
        assert forbidden not in serialized
    assert all("key=" not in marker["navigation_url"] for marker in preview["markers"])

    repeat = client.post(
        "/api/admin/plans/2033-10-01/route/preview",
        json={"expected_revision": preview["revision"], "geocode_missing": True},
    )
    assert repeat.status_code == 200
    assert len(fake_map_provider.geocode_calls) == 2

    current_day = client.get("/api/admin/plans/2033-10-01").json()
    times = {task["id"]: task["planned_time"] for task in current_day["tasks"]}
    adopted_response = client.put(
        "/api/admin/plans/2033-10-01/schedule",
        json={
            "expected_revision": current_day["revision"],
            "tasks": [
                {"task_id": task_id, "planned_time": times[task_id]}
                for task_id in preview["recommended_task_ids"]
            ],
        },
    )
    assert adopted_response.status_code == 200
    adopted = adopted_response.json()
    assert [task["id"] for task in adopted["tasks"]] == preview["recommended_task_ids"]
    assert [task["sort_order"] for task in adopted["tasks"]] == [0, 1, 2]


def test_route_preview_caches_order_coordinates_and_ignores_later_profile_changes(
    plan_api_context: PlanApiContext,
    fake_map_provider: FakeMapProvider,
) -> None:
    client = plan_api_context.client
    create_three_task_plan(client)
    initial = client.get("/api/admin/plans/2033-10-01").json()
    preview = client.post(
        "/api/admin/plans/2033-10-01/route/preview",
        json={"expected_revision": initial["revision"]},
    ).json()
    customer_id = initial["tasks"][0]["customer"]["id"]
    customer_task_ids = [
        task["id"]
        for task in initial["tasks"]
        if task["customer"]["id"] == customer_id
    ]

    with plan_api_context.session_factory() as session:
        customer = session.get(Customer, customer_id)
        assert customer is not None
        assert customer.geocode_status == "resolved"
        order_ids = {
            task.order_id
            for task in session.scalars(
                select(Task).where(Task.id.in_(customer_task_ids))
            ).all()
        }
        assert len(order_ids) == 1
        order = session.get(Order, next(iter(order_ids)))
        assert order is not None
        assert order.route_geocode_status == "resolved"
        assert order.route_latitude == Decimal("30.1000000")
        snapshots = session.scalars(
            select(Task).where(Task.id.in_(customer_task_ids)).order_by(Task.id)
        ).all()
        assert all(task.planned_lat == Decimal("30.1000000") for task in snapshots)

    unchanged = client.patch(
        f"/api/admin/customers/{customer_id}",
        json={"notes": "只修改虚构备注", "unit": "新单元", "room": "新房号"},
    )
    assert unchanged.status_code == 200
    with plan_api_context.session_factory() as session:
        customer = session.get(Customer, customer_id)
        assert customer is not None
        assert customer.geocode_status == "pending"

    changed = client.patch(
        f"/api/admin/customers/{customer_id}",
        json={"address": "另一条虚构道路 200 号"},
    )
    assert changed.status_code == 200
    with plan_api_context.session_factory() as session:
        customer = session.get(Customer, customer_id)
        assert customer is not None
        assert customer.geocode_status == "pending"
        assert customer.latitude is None
        order = session.scalar(select(Order).where(Order.customer_id == customer_id))
        assert order is not None
        assert order.contact_address == "虚构路 100 号"
        assert order.route_geocode_status == "resolved"
        assert order.route_latitude == Decimal("30.1000000")
        snapshots = session.scalars(
            select(Task).where(Task.id.in_(customer_task_ids)).order_by(Task.id)
        ).all()
        assert all(task.planned_lat == Decimal("30.1000000") for task in snapshots)

    workspace = client.get("/api/admin/plans/2033-10-01/route").json()
    assert workspace["unresolved_tasks"] == []
    assert {marker["task_id"] for marker in workspace["markers"]}.issuperset(
        customer_task_ids
    )
    refreshed_day = client.get("/api/admin/plans/2033-10-01").json()
    assert refreshed_day["revision"] == preview["revision"]
    refreshed = client.post(
        "/api/admin/plans/2033-10-01/route/preview",
        json={"expected_revision": refreshed_day["revision"]},
    )
    assert refreshed.status_code == 200
    assert len(fake_map_provider.geocode_calls) == 2
    assert refreshed.json()["revision"] == preview["revision"]


def test_partial_geocode_failure_disables_recommendation_and_disabled_provider_is_safe(
    plan_api_context: PlanApiContext,
) -> None:
    client = plan_api_context.client
    create_three_task_plan(client)
    day = client.get("/api/admin/plans/2033-10-01").json()

    partial_provider = FakeMapProvider(
        geocode_results=[GeoPoint(latitude=30.1, longitude=120.1), None]
    )
    services = MapServices(
        partial_provider,
        partial_provider,
        partial_provider,
        partial_provider,
    )
    app.dependency_overrides[get_map_services] = lambda: services
    try:
        response = client.post(
            "/api/admin/plans/2033-10-01/route/preview",
            json={"expected_revision": day["revision"]},
        )
        assert response.status_code == 200
        payload = response.json()
        assert len(payload["markers"]) == 2
        assert len(payload["unresolved_tasks"]) == 1
        assert payload["unresolved_tasks"][0]["reason"] == "geocode_failed"
        assert payload["current_route"] is not None
        assert payload["recommended_route"] is None
        assert payload["recommended_task_ids"] == []
        assert payload["can_adopt_recommendation"] is False
    finally:
        app.dependency_overrides.pop(get_map_services, None)

    unavailable = UnavailableMapProvider("disabled", "地图服务尚未配置")
    app.dependency_overrides[get_map_services] = lambda: MapServices(
        unavailable,
        unavailable,
        unavailable,
        unavailable,
    )
    try:
        workspace = client.get("/api/admin/plans/2033-10-01/route")
        assert workspace.status_code == 200
        assert workspace.json()["provider"]["configured"] is False
        current = client.get("/api/admin/plans/2033-10-01").json()
        blocked = client.post(
            "/api/admin/plans/2033-10-01/route/preview",
            json={"expected_revision": current["revision"]},
        )
        assert blocked.status_code == 503
        assert blocked.json()["detail"] == "地图服务尚未配置"
    finally:
        app.dependency_overrides.pop(get_map_services, None)

    assert client.get("/api/admin/plans/2033-10-03/route").status_code == 404


def test_route_refresh_preserves_executed_snapshot_and_obeys_day_lock(
    plan_api_context: PlanApiContext,
    fake_map_provider: FakeMapProvider,
) -> None:
    client = plan_api_context.client
    create_three_task_plan(client)
    initial = client.get("/api/admin/plans/2033-10-01").json()
    first_preview = client.post(
        "/api/admin/plans/2033-10-01/route/preview",
        json={"expected_revision": initial["revision"]},
    )
    assert first_preview.status_code == 200
    first_task = initial["tasks"][0]
    customer_id = first_task["customer"]["id"]
    same_customer_task_ids = [
        task["id"]
        for task in initial["tasks"]
        if task["customer"]["id"] == customer_id
    ]
    assert len(same_customer_task_ids) == 2

    with plan_api_context.session_factory.begin() as session:
        task = session.get(Task, first_task["id"])
        assert task is not None
        task.started_at = datetime(2033, 10, 1, 9, 0, tzinfo=timezone.utc)

    before_address_change = client.get("/api/admin/plans/2033-10-01").json()
    assert client.patch(
        f"/api/admin/customers/{customer_id}",
        json={"address": "执行后变更的虚构道路 300 号"},
    ).status_code == 200
    unchanged_preview = client.post(
        "/api/admin/plans/2033-10-01/route/preview",
        json={"expected_revision": before_address_change["revision"]},
    )
    assert unchanged_preview.status_code == 200

    current = client.get("/api/admin/plans/2033-10-01").json()
    refreshed_response = client.post(
        "/api/admin/plans/2033-10-01/route/preview",
        json={"expected_revision": current["revision"]},
    )
    assert refreshed_response.status_code == 200
    refreshed = refreshed_response.json()
    assert refreshed["schedule_locked"] is True
    assert refreshed["can_adopt_recommendation"] is False

    with plan_api_context.session_factory() as session:
        snapshots = {
            task.id: task
            for task in session.scalars(
                select(Task).where(Task.id.in_(same_customer_task_ids))
            ).all()
        }
        assert snapshots[first_task["id"]].planned_lat == Decimal("30.1000000")
        other_task_id = next(
            task_id for task_id in same_customer_task_ids if task_id != first_task["id"]
        )
        assert snapshots[other_task_id].planned_lat == Decimal("30.1000000")
    assert len(fake_map_provider.geocode_calls) == 2


def test_cancelled_tasks_are_excluded_and_missing_address_is_not_guessed(
    plan_api_context: PlanApiContext,
    fake_map_provider: FakeMapProvider,
) -> None:
    client = plan_api_context.client
    first_order, _ = create_three_task_plan(client)
    assert client.patch(
        f"/api/admin/orders/{first_order['id']}/status",
        json={"order_status": "cancelled"},
    ).status_code == 200
    day = client.get("/api/admin/plans/2033-10-01").json()
    active_tasks = [task for task in day["tasks"] if task["status"] != "cancelled"]
    assert len(active_tasks) == 1
    order_id = active_tasks[0]["order_id"]
    order = client.get(f"/api/admin/orders/{order_id}").json()
    contact = {
        **order["service_contact"],
        "community": None,
        "address": None,
        "building": None,
        "unit": None,
        "room": None,
        "latitude": None,
        "longitude": None,
        "geocode_status": None,
    }
    assert client.patch(
        f"/api/admin/orders/{order_id}",
        json={"service_contact": contact},
    ).status_code == 200

    current = client.get("/api/admin/plans/2033-10-01").json()
    response = client.post(
        "/api/admin/plans/2033-10-01/route/preview",
        json={"expected_revision": current["revision"]},
    )
    assert response.status_code == 200
    workspace = response.json()
    assert workspace["markers"] == []
    assert workspace["current_route"] is None
    assert workspace["recommended_route"] is None
    assert workspace["unresolved_tasks"] == [
        {
            "task_id": active_tasks[0]["id"],
            "customer_name": active_tasks[0]["customer"]["name"],
            "community": None,
            "address": None,
            "reason": "missing_address",
        }
    ]
    assert len(fake_map_provider.geocode_calls) == 2
