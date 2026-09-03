from dataclasses import dataclass
from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.main import app
from app.maps import (
    GeoPoint,
    GeocodeResult,
    MapServices,
    ProviderState,
    RouteResult,
    RouteStop,
)
from app.maps.factory import UnavailableMapProvider, get_map_services
from app.models import OrderStatus, Task, TaskStatus
from app.api import mobile as mobile_api
from tests.test_task_api import (
    TaskApiContext,
    create_task_order,
    image_bytes,
    task_api_context,
)


@dataclass
class MobileMapProvider:
    navigation_calls: int = 0
    geocode_calls: int = 0

    def provider_state(self) -> ProviderState:
        return ProviderState("amap", True, "GCJ-02")

    def home_point(self) -> GeoPoint:
        return GeoPoint(latitude=30.0, longitude=120.0)

    def geocode(self, address: str) -> GeocodeResult | None:
        del address
        self.geocode_calls += 1
        return GeocodeResult(
            GeoPoint(30.1234567, 120.7654321),
            "深圳市",
            "龙岗区",
            "440307",
            "门牌号",
        )

    def plan_route(self, origin: GeoPoint, stops: list[RouteStop]) -> RouteResult:
        del origin, stops
        raise AssertionError("读取手机今日任务时不得调用路线规划")

    def recommend_order(
        self,
        origin: GeoPoint,
        stops: list[RouteStop],
    ) -> list[RouteStop]:
        del origin, stops
        raise AssertionError("读取手机今日任务时不得调用路线推荐")

    def navigation_url(
        self,
        origin: GeoPoint | None,
        destination: GeoPoint,
        destination_name: str,
    ) -> str:
        del origin
        self.navigation_calls += 1
        return (
            "https://uri.amap.com/navigation?"
            f"to={destination.longitude:.6f},{destination.latitude:.6f},{destination_name}"
        )


@pytest.fixture
def mobile_map_provider() -> MobileMapProvider:
    provider = MobileMapProvider()
    services = MapServices(provider, provider, provider, provider)
    app.dependency_overrides[get_map_services] = lambda: services
    try:
        yield provider
    finally:
        app.dependency_overrides.pop(get_map_services, None)


def _set_task_state(
    session: Session,
    task_id: int,
    *,
    status: TaskStatus | None = None,
    latitude: str | None = None,
    longitude: str | None = None,
) -> None:
    task = session.get(Task, task_id)
    assert task is not None
    if status is not None:
        task.status = status
    if latitude is not None:
        task.planned_lat = Decimal(latitude)
    if longitude is not None:
        task.planned_lng = Decimal(longitude)
    if latitude is not None and longitude is not None:
        task.customer.geocode_status = "resolved"
    session.commit()


def test_mobile_today_is_ordered_privacy_minimized_and_uses_cached_navigation(
    task_api_context: TaskApiContext,
    mobile_map_provider: MobileMapProvider,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = task_api_context.client
    monkeypatch.setattr(
        mobile_api,
        "current_business_date",
        lambda: date(2035, 10, 5),
    )
    empty = client.get("/api/mobile/today")
    assert empty.status_code == 200
    assert empty.json() == {
        "business_date": "2035-10-05",
        "task_count": 0,
        "open_task_count": 0,
        "completed_task_count": 0,
        "tasks": [],
    }

    order = create_task_order(client, visits_per_day=2)
    assert mobile_map_provider.geocode_calls == 1
    mobile_map_provider.geocode_calls = 0
    first_id, second_id = [task["id"] for task in order["tasks"]]
    with task_api_context.session_factory() as session:
        _set_task_state(
            session,
            first_id,
            latitude="30.1234567",
            longitude="120.7654321",
        )

    response = client.get("/api/mobile/today?date=2035-10-06")
    assert response.status_code == 200
    payload = response.json()
    assert payload["task_count"] == 2
    assert payload["open_task_count"] == 2
    assert [task["id"] for task in payload["tasks"]] == [first_id, second_id]
    assert [task["sequence"] for task in payload["tasks"]] == [1, 2]
    assert {task["order_id"] for task in payload["tasks"]} == {order["id"]}
    assert {task["order_number"] for task in payload["tasks"]} == {
        order["order_number"]
    }
    assert payload["tasks"][0]["navigation_state"] == "ready"
    assert payload["tasks"][0]["navigation_url"].startswith(
        "https://uri.amap.com/navigation?"
    )
    assert "key=" not in payload["tasks"][0]["navigation_url"]
    assert payload["tasks"][1]["navigation_state"] == "ready"
    assert payload["tasks"][1]["navigation_url"].startswith(
        "https://uri.amap.com/navigation?"
    )
    assert all(
        task["address"] == "P6 虚构小区 P6 虚构路 6 号 6 栋 6 单元 606"
        for task in payload["tasks"]
    )
    assert mobile_map_provider.geocode_calls == 0
    assert mobile_map_provider.navigation_calls == 2

    serialized = response.text
    for forbidden in (
        "000-P6-TEST",
        "虚构门禁说明",
        "FAKE-P6-KEY",
        "虚构用药说明",
        "虚构 P6 订单备注",
        "/photos/",
    ):
        assert forbidden not in serialized

    unavailable = UnavailableMapProvider("disabled", "测试地图未配置")
    app.dependency_overrides[get_map_services] = lambda: MapServices(
        unavailable,
        unavailable,
        unavailable,
        unavailable,
    )
    disabled_payload = client.get("/api/mobile/today?date=2035-10-06").json()
    assert disabled_payload["tasks"][0]["navigation_state"] == "provider_unavailable"
    assert disabled_payload["tasks"][0]["navigation_url"] is None

    with task_api_context.session_factory() as session:
        _set_task_state(session, first_id, status=TaskStatus.EXCEPTION)
        _set_task_state(session, second_id, status=TaskStatus.CANCELLED)

    filtered = client.get("/api/mobile/today?date=2035-10-06").json()
    assert filtered["task_count"] == 1
    assert filtered["open_task_count"] == 0
    assert filtered["completed_task_count"] == 0
    assert filtered["tasks"][0]["id"] == first_id
    assert filtered["tasks"][0]["status"] == "exception"

    with task_api_context.session_factory() as session:
        _set_task_state(session, first_id, status=TaskStatus.COMPLETED)
    completed = client.get("/api/mobile/today?date=2035-10-06").json()
    assert completed["completed_task_count"] == 1

    with task_api_context.session_factory() as session:
        task = session.get(Task, first_id)
        assert task is not None
        task.order.order_status = OrderStatus.CANCELLED
        session.commit()
    assert client.get("/api/mobile/today?date=2035-10-06").json()["tasks"] == []


def test_mobile_task_execution_reuses_revision_upload_and_completion_rules(
    task_api_context: TaskApiContext,
) -> None:
    client: TestClient = task_api_context.client
    order = create_task_order(client, service_items=["feed", "water", "photo"])
    task_id = order["tasks"][0]["id"]

    original_response = client.get(f"/api/mobile/tasks/{task_id}")
    assert original_response.status_code == 200
    original = original_response.json()
    assert original["order_number"] == order["order_number"]
    assert original["customer"]["address"] == "P6 虚构路 6 号"
    assert original["customer"]["access_info"] == "虚构门禁说明"

    started_response = client.post(
        f"/api/mobile/tasks/{task_id}/start",
        json={"expected_revision": original["revision"]},
    )
    assert started_response.status_code == 200
    detail = started_response.json()
    assert detail["status"] == "in_progress"

    stale = client.put(
        f"/api/mobile/tasks/{task_id}/notes",
        json={
            "expected_revision": original["revision"],
            "notes": "不应保存",
            "cat_status": "不应保存",
        },
    )
    assert stale.status_code == 409

    for item in detail["items"]:
        if item["item_type"] == "photo":
            continue
        updated = client.patch(
            f"/api/mobile/tasks/{task_id}/items/{item['id']}",
            json={
                "expected_revision": detail["revision"],
                "completed": True,
            },
        )
        assert updated.status_code == 200
        detail = updated.json()

    saved = client.put(
        f"/api/mobile/tasks/{task_id}/notes",
        json={
            "expected_revision": detail["revision"],
            "notes": "移动端虚构执行备注",
            "cat_status": "移动端虚构猫咪状态",
        },
    )
    assert saved.status_code == 200
    detail = saved.json()

    upload = client.post(
        f"/api/mobile/tasks/{task_id}/photos",
        data={"expected_revision": detail["revision"]},
        files={"photo": ("../../private-name.png", image_bytes(), "image/png")},
    )
    assert upload.status_code == 200
    detail = upload.json()
    assert len(detail["photos"]) == 1
    photo = detail["photos"][0]
    assert photo["url"] == f"/api/mobile/tasks/{task_id}/photos/{photo['id']}"
    assert "private-name" not in upload.text
    assert str(task_api_context.upload_root) not in upload.text

    photo_response = client.get(photo["url"])
    assert photo_response.status_code == 200
    assert photo_response.headers["cache-control"] == "private, no-store"
    assert photo_response.headers["x-content-type-options"] == "nosniff"
    assert photo_response.headers["content-type"] == "image/png"

    admin_detail = client.get(f"/api/admin/tasks/{task_id}").json()
    assert admin_detail["photos"][0]["url"] == (
        f"/api/admin/tasks/{task_id}/photos/{photo['id']}"
    )

    completed = client.post(
        f"/api/mobile/tasks/{task_id}/complete",
        json={"expected_revision": detail["revision"]},
    )
    assert completed.status_code == 200
    assert completed.json()["status"] == "completed"
    assert completed.json()["order_status"] == "completed"
    assert completed.json()["photos"][0]["url"].startswith("/api/mobile/")

    assert client.post(
        f"/api/mobile/tasks/{task_id}/exception",
        json={"expected_revision": completed.json()["revision"], "exception_notes": "x"},
    ).status_code == 404
