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
from app.maps import (
    GeoPoint,
    GeocodeResult,
    MapProviderError,
    MapServices,
    ProviderState,
    RouteResult,
    RouteStop,
)
from app.maps.factory import UnavailableMapProvider, get_map_services
from app.models import Customer, Order, Task
from app.services.geocoding import geocode_fingerprint
from app.services.orders import order_geocode_address
from tests.test_plan_api import PlanApiContext, create_order, create_three_task_plan


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
    geocode_results: list[GeocodeResult | None]
    geocode_calls: list[str] = field(default_factory=list)
    route_calls: list[list[int]] = field(default_factory=list)
    route_error: str | None = None
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

    def geocode(self, address: str) -> GeocodeResult | None:
        self.geocode_calls.append(address)
        return self.geocode_results[len(self.geocode_calls) - 1]

    def plan_route(self, origin: GeoPoint, stops: list[RouteStop]) -> RouteResult:
        self.route_calls.append([stop.task_id for stop in stops])
        if self.route_error:
            raise MapProviderError(self.route_error)
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
            GeocodeResult(GeoPoint(30.10, 120.10), "深圳市", "龙岗区", "440307", "门牌号"),
            GeocodeResult(GeoPoint(30.20, 120.20), "深圳市", "龙岗区", "440307", "门牌号"),
            GeocodeResult(GeoPoint(30.30, 120.30), "深圳市", "龙岗区", "440307", "门牌号"),
        ]
    )
    services = MapServices(provider, provider, provider, provider)
    app.dependency_overrides[get_map_services] = lambda: services
    try:
        yield provider
    finally:
        app.dependency_overrides.pop(get_map_services, None)


def test_order_save_geocodes_before_explicit_round_trip_preview(
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
    assert local["route_mode"] == "round_trip"
    assert local["optimization"] is None
    assert local["road_route"] == {
        "status": "not_generated",
        "path": None,
        "message": None,
    }
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
    assert preview["road_route"]["status"] == "ready"
    assert preview["road_route"]["path"]["distance_meters"] == 12600
    assert preview["road_route"]["path"]["duration_seconds"] == 2880
    assert preview["optimization"]["method"] == "exact"
    assert preview["optimization"]["planned_time_policy"] == "precedence"
    assert preview["optimization"]["baseline_task_ids"] == [
        task["id"] for task in day["tasks"]
    ]
    optimized_task_ids = [
        day["tasks"][0]["id"],
        day["tasks"][2]["id"],
        day["tasks"][1]["id"],
    ]
    assert preview["optimization"]["optimized_task_ids"] == optimized_task_ids
    assert preview["can_adopt_recommendation"] is True
    assert fake_map_provider.route_calls == [
        optimized_task_ids + [0]
    ]
    assert preview["revision"] == day["revision"]

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
    planned_times = {
        task["id"]: task["planned_time"] for task in current_day["tasks"]
    }
    adopted_response = client.put(
        "/api/admin/plans/2033-10-01/schedule",
        json={
            "expected_revision": current_day["revision"],
            "tasks": [
                {"task_id": task_id, "planned_time": planned_times[task_id]}
                for task_id in optimized_task_ids
            ],
        },
    )
    assert adopted_response.status_code == 200
    assert [
        task["id"] for task in adopted_response.json()["tasks"]
    ] == optimized_task_ids


def test_manual_customer_pin_syncs_only_unexecuted_tasks_and_restore_is_fail_safe(
    plan_api_context: PlanApiContext,
    fake_map_provider: FakeMapProvider,
) -> None:
    client = plan_api_context.client
    first_order, _ = create_three_task_plan(client)
    fake_map_provider.geocode_results.extend(
        [
            GeocodeResult(GeoPoint(30.11, 120.11), "深圳市", "龙岗区", "440307", "门牌号"),
            GeocodeResult(GeoPoint(30.12, 120.12), "深圳市", "龙岗区", "440307", "门牌号"),
        ]
    )
    cat_ids = [cat["id"] for cat in first_order["cats"]]
    same_address_order = create_order(
        client,
        customer_id=first_order["customer"]["id"],
        cat_ids=cat_ids,
        start_date="2033-10-03",
        end_date="2033-10-03",
        visits_per_day=1,
    )
    different_address_order = create_order(
        client,
        customer_id=first_order["customer"]["id"],
        cat_ids=cat_ids,
        start_date="2033-10-04",
        end_date="2033-10-04",
        visits_per_day=1,
    )
    with plan_api_context.session_factory.begin() as session:
        different = session.get(Order, different_address_order["id"])
        assert different is not None
        different.contact_address = "深圳市龙岗区虚构路 999 号"
        different.route_latitude = Decimal("22.700001")
        different.route_longitude = Decimal("114.700002")
        for task in different.tasks:
            task.planned_lat = different.route_latitude
            task.planned_lng = different.route_longitude
    day_one = client.get("/api/admin/plans/2033-10-01").json()
    detail = client.get(
        f"/api/admin/plans/tasks/{day_one['tasks'][0]['id']}"
    ).json()
    assert detail["location_scope"] == "customer"

    with plan_api_context.session_factory.begin() as session:
        historical = session.scalar(
            select(Task).where(
                Task.order_id == first_order["id"],
                Task.service_date == datetime(2033, 10, 2).date(),
            )
        )
        assert historical is not None
        historical.started_at = datetime(2033, 10, 2, 9, 0, tzinfo=timezone.utc)
        historical_original = (historical.planned_lat, historical.planned_lng)

    day_one = client.get("/api/admin/plans/2033-10-01").json()
    detail = client.get(
        f"/api/admin/plans/tasks/{day_one['tasks'][0]['id']}"
    ).json()
    endpoint = f"/api/admin/customers/{detail['customer']['id']}/location"
    payload = {
        "latitude": 22.610001,
        "longitude": 114.050002,
        "coordinate_system": "GCJ-02",
        "source_order_id": first_order["id"],
        "service_date": "2033-10-01",
        "expected_customer_updated_at": detail["customer"]["updated_at"],
        "expected_day_revision": day_one["revision"],
    }
    wrong_coordinate_system = client.patch(
        endpoint,
        json={**payload, "coordinate_system": "WGS-84"},
    )
    assert wrong_coordinate_system.status_code == 422
    response = client.patch(endpoint, json=payload)
    assert response.status_code == 200
    result = response.json()
    assert result["scope"] == "customer"
    assert result["affected_orders"] == 2
    assert result["affected_tasks"] == 4
    assert result["position"] == {"latitude": 22.610001, "longitude": 114.050002}

    with plan_api_context.session_factory() as session:
        order = session.get(Order, first_order["id"])
        assert order is not None
        address = order_geocode_address(order)
        assert address
        assert order.route_geocode_status == "manual"
        assert order.route_geocode_fingerprint == geocode_fingerprint(
            "manual", address
        )
        current_historical = session.get(Task, historical.id)
        assert current_historical is not None
        assert (
            current_historical.planned_lat,
            current_historical.planned_lng,
        ) == historical_original
        changed_tasks = session.scalars(
            select(Task).where(
                Task.order_id == first_order["id"],
                Task.id != historical.id,
            )
        ).all()
        assert all(
            float(task.planned_lat or 0) == pytest.approx(22.610001)
            for task in changed_tasks
        )
        assert all(
            float(task.planned_lng or 0) == pytest.approx(114.050002)
            for task in changed_tasks
        )
        same_address = session.get(Order, same_address_order["id"])
        assert same_address is not None
        assert float(same_address.route_latitude or 0) == pytest.approx(22.610001)
        different_address = session.get(Order, different_address_order["id"])
        assert different_address is not None
        assert float(different_address.route_latitude or 0) == pytest.approx(22.700001)
        assert all(
            float(task.planned_lng or 0) == pytest.approx(114.700002)
            for task in different_address.tasks
        )

    route = client.get("/api/admin/plans/2033-10-01/route").json()
    first_order_markers = [
        marker for marker in route["markers"] if marker["task_id"] in {
            task["id"] for task in day_one["tasks"] if task["order_id"] == first_order["id"]
        }
    ]
    assert first_order_markers
    assert all(marker["position"] == result["position"] for marker in first_order_markers)
    assert client.patch(endpoint, json=payload).status_code == 409

    geocode_calls_before_inherited_order = len(fake_map_provider.geocode_calls)
    inherited_order = create_order(
        client,
        customer_id=first_order["customer"]["id"],
        cat_ids=cat_ids,
        start_date="2033-10-05",
        end_date="2033-10-05",
        visits_per_day=1,
    )
    assert len(fake_map_provider.geocode_calls) == geocode_calls_before_inherited_order
    with plan_api_context.session_factory() as session:
        inherited = session.get(Order, inherited_order["id"])
        assert inherited is not None
        assert inherited.route_geocode_status == "manual"
        assert float(inherited.route_latitude or 0) == pytest.approx(22.610001)

    latest_day = client.get("/api/admin/plans/2033-10-01").json()
    latest_detail = client.get(
        f"/api/admin/plans/tasks/{latest_day['tasks'][0]['id']}"
    ).json()
    geocode_calls_before_stale_restore = len(fake_map_provider.geocode_calls)
    stale_restore = client.post(
        f"/api/admin/customers/{latest_detail['customer']['id']}/location/restore-auto",
        json={
            "source_order_id": first_order["id"],
            "service_date": "2033-10-01",
            "expected_customer_updated_at": detail["customer"]["updated_at"],
            "expected_day_revision": latest_day["revision"],
        },
    )
    assert stale_restore.status_code == 409
    assert len(fake_map_provider.geocode_calls) == geocode_calls_before_stale_restore

    next_geocode_index = len(fake_map_provider.geocode_calls)
    fake_map_provider.geocode_results[next_geocode_index] = None
    restore = client.post(
        f"/api/admin/customers/{latest_detail['customer']['id']}/location/restore-auto",
        json={
            "source_order_id": first_order["id"],
            "service_date": "2033-10-01",
            "expected_customer_updated_at": latest_detail["customer"]["updated_at"],
            "expected_day_revision": latest_day["revision"],
        },
    )
    assert restore.status_code == 409
    with plan_api_context.session_factory() as session:
        order = session.get(Order, first_order["id"])
        assert order is not None
        assert order.route_geocode_status == "manual"
        assert float(order.route_latitude or 0) == pytest.approx(22.610001)

    changed_customer = client.patch(
        f"/api/admin/customers/{latest_detail['customer']['id']}",
        json={"address": "深圳市龙岗区另一条虚构路 1 号"},
    )
    assert changed_customer.status_code == 200
    with plan_api_context.session_factory() as session:
        customer = session.get(Customer, latest_detail["customer"]["id"])
        assert customer is not None
        assert customer.geocode_status == "pending"
        assert customer.latitude is None
        assert customer.geocode_fingerprint is None
        historical_order = session.get(Order, first_order["id"])
        assert historical_order is not None
        assert historical_order.route_geocode_status == "manual"
        assert float(historical_order.route_latitude or 0) == pytest.approx(22.610001)


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
        geocode_results=[
            GeocodeResult(GeoPoint(30.1, 120.1), "深圳市", "龙岗区", "440307", "门牌号"),
            None,
        ]
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
        assert payload["optimization"] is None
        assert payload["road_route"]["status"] == "not_generated"
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
    assert workspace["optimization"] is None
    assert workspace["road_route"]["status"] == "not_generated"
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


def test_stale_cached_coordinates_are_revalidated_before_route_planning(
    plan_api_context: PlanApiContext,
    fake_map_provider: FakeMapProvider,
) -> None:
    client = plan_api_context.client
    create_three_task_plan(client)
    day = client.get("/api/admin/plans/2033-10-01").json()
    order_id = day["tasks"][0]["order_id"]

    with plan_api_context.session_factory.begin() as session:
        order = session.get(Order, order_id)
        assert order is not None
        order.route_latitude = Decimal("47.1166480")
        order.route_longitude = Decimal("124.8523860")
        order.route_geocode_fingerprint = None

    stale = client.get("/api/admin/plans/2033-10-01/route").json()
    stale_task_ids = {
        task["id"] for task in day["tasks"] if task["order_id"] == order_id
    }
    assert {issue["task_id"] for issue in stale["unresolved_tasks"]} == stale_task_ids
    assert {issue["reason"] for issue in stale["unresolved_tasks"]} == {
        "stale_geocode"
    }
    assert stale_task_ids.isdisjoint(
        marker["task_id"] for marker in stale["markers"]
    )

    current = client.get("/api/admin/plans/2033-10-01").json()
    preview = client.post(
        "/api/admin/plans/2033-10-01/route/preview",
        json={"expected_revision": current["revision"], "geocode_missing": True},
    )

    assert preview.status_code == 200
    assert preview.json()["unresolved_tasks"] == []
    with plan_api_context.session_factory() as session:
        order = session.get(Order, order_id)
        assert order is not None
        assert order.route_latitude == Decimal("30.3000000")
        assert order.route_longitude == Decimal("120.3000000")
        assert order.route_geocode_fingerprint is not None


def test_geocode_region_mismatch_blocks_incomplete_route(
    plan_api_context: PlanApiContext,
    fake_map_provider: FakeMapProvider,
) -> None:
    client = plan_api_context.client
    create_three_task_plan(client)
    day = client.get("/api/admin/plans/2033-10-01").json()
    order_id = day["tasks"][0]["order_id"]

    with plan_api_context.session_factory.begin() as session:
        order = session.get(Order, order_id)
        assert order is not None
        order.route_geocode_fingerprint = None

    fake_map_provider.geocode_calls.clear()
    fake_map_provider.geocode_results = [
        GeocodeResult(
            GeoPoint(23.129112, 113.264385),
            "广州市",
            "越秀区",
            "440104",
            "门牌号",
        )
    ]
    fake_map_provider.route_calls.clear()
    current = client.get("/api/admin/plans/2033-10-01").json()

    response = client.post(
        "/api/admin/plans/2033-10-01/route/preview",
        json={"expected_revision": current["revision"]},
    )

    assert response.status_code == 200
    payload = response.json()
    mismatch_task_ids = {
        task["id"] for task in day["tasks"] if task["order_id"] == order_id
    }
    assert {issue["task_id"] for issue in payload["unresolved_tasks"]} == mismatch_task_ids
    assert {issue["reason"] for issue in payload["unresolved_tasks"]} == {
        "geocode_mismatch"
    }
    assert payload["optimization"] is None
    assert payload["road_route"]["status"] == "not_generated"
    assert fake_map_provider.route_calls == []


def test_road_route_failure_degrades_without_discarding_local_optimization(
    plan_api_context: PlanApiContext,
    fake_map_provider: FakeMapProvider,
) -> None:
    client = plan_api_context.client
    create_three_task_plan(client)
    fake_map_provider.route_error = "高德服务端繁忙（UNKNOWN / 10016）"
    day = client.get("/api/admin/plans/2033-10-01").json()

    response = client.post(
        "/api/admin/plans/2033-10-01/route/preview",
        json={"expected_revision": day["revision"]},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["optimization"] is not None
    assert payload["road_route"]["status"] == "degraded"
    assert payload["road_route"]["path"] is None
    assert "10016" in payload["road_route"]["message"]
