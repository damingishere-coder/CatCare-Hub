from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.maps import GeoPoint, MapServices, ProviderState
from app.maps.factory import get_map_services
from app.services.route_recommendation import (
    RecommendationProviderState,
    get_route_recommender,
)


class FakeMapProvider:
    def __init__(self, *, configured: bool = True) -> None:
        self.configured = configured
        self.geocode_calls: list[str] = []

    def provider_state(self) -> ProviderState:
        return ProviderState(
            name="amap",
            configured=self.configured,
            coordinate_system="GCJ-02",
            message=None if self.configured else "请在本机配置高德 Web 服务 Key",
        )

    def home_point(self) -> GeoPoint | None:
        return GeoPoint(latitude=30.0, longitude=120.0) if self.configured else None

    def geocode(self, address: str) -> GeoPoint | None:
        self.geocode_calls.append(address)
        return GeoPoint(latitude=30.27, longitude=120.15)


class FakeRouteRecommender:
    def __init__(self, *, configured: bool = True) -> None:
        self.configured = configured
        self.test_calls = 0

    def provider_state(self) -> RecommendationProviderState:
        return RecommendationProviderState(
            name="openai",
            configured=self.configured,
            message=None if self.configured else "未配置独立 OpenAI API Key",
        )

    def test_connection(self) -> None:
        self.test_calls += 1


@pytest.fixture
def settings_context() -> Generator[
    tuple[TestClient, FakeMapProvider, FakeRouteRecommender], None, None
]:
    map_provider = FakeMapProvider()
    recommender = FakeRouteRecommender()
    services = MapServices(
        map_provider=map_provider,
        geocode_provider=map_provider,
        route_provider=map_provider,
        navigation_provider=map_provider,
    )
    app.dependency_overrides[get_map_services] = lambda: services
    app.dependency_overrides[get_route_recommender] = lambda: recommender
    try:
        with TestClient(app) as client:
            yield client, map_provider, recommender
    finally:
        app.dependency_overrides.pop(get_map_services, None)
        app.dependency_overrides.pop(get_route_recommender, None)


def test_settings_show_configuration_without_claiming_connection_or_leaking_keys(
    settings_context: tuple[TestClient, FakeMapProvider, FakeRouteRecommender],
) -> None:
    client, _, _ = settings_context

    response = client.get("/api/admin/settings/integrations")

    assert response.status_code == 200
    payload = response.json()
    assert payload["amap_backend"] == {
        "name": "amap",
        "configured": True,
        "status": "configured",
        "message": None,
    }
    assert payload["gpt_recommendation"] == {
        "name": "openai",
        "configured": True,
        "status": "configured",
        "message": None,
    }
    serialized = response.text.lower()
    assert "api_key" not in serialized
    assert "secret" not in serialized
    assert "connected" not in serialized


def test_settings_manual_connection_tests_use_public_place_and_each_provider(
    settings_context: tuple[TestClient, FakeMapProvider, FakeRouteRecommender],
) -> None:
    client, map_provider, recommender = settings_context

    amap_response = client.post(
        "/api/admin/settings/integrations/test", json={"target": "amap"}
    )
    openai_response = client.post(
        "/api/admin/settings/integrations/test", json={"target": "openai"}
    )

    assert amap_response.status_code == 200
    assert amap_response.json()["connected"] is True
    assert map_provider.geocode_calls == ["杭州市民中心"]
    assert openai_response.status_code == 200
    assert openai_response.json()["connected"] is True
    assert recommender.test_calls == 1


def test_unconfigured_amap_manual_test_fails_without_external_request() -> None:
    map_provider = FakeMapProvider(configured=False)
    recommender = FakeRouteRecommender()
    services = MapServices(
        map_provider=map_provider,
        geocode_provider=map_provider,
        route_provider=map_provider,
        navigation_provider=map_provider,
    )
    app.dependency_overrides[get_map_services] = lambda: services
    app.dependency_overrides[get_route_recommender] = lambda: recommender
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/admin/settings/integrations/test", json={"target": "amap"}
            )
    finally:
        app.dependency_overrides.pop(get_map_services, None)
        app.dependency_overrides.pop(get_route_recommender, None)

    assert response.status_code == 502
    assert "配置" in response.json()["detail"]
    assert map_provider.geocode_calls == []
