import httpx
import pytest

from app.maps import GeoPoint, MapProviderError, RouteStop
from app.maps.amap import AmapProvider


def test_amap_adapter_parses_geocode_route_and_builds_keyless_navigation() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/v3/geocode/geo":
            return httpx.Response(
                200,
                json={
                    "status": "1",
                    "geocodes": [{"location": "120.123456,30.123456"}],
                },
            )
        if request.url.path == "/v3/direction/driving":
            return httpx.Response(
                200,
                json={
                    "status": "1",
                    "route": {
                        "paths": [
                            {
                                "distance": "12600",
                                "duration": "2880",
                                "steps": [
                                    {
                                        "polyline": (
                                            "120.100000,30.100000;"
                                            "120.110000,30.110000;"
                                            "120.123456,30.123456"
                                        )
                                    }
                                ],
                            }
                        ]
                    },
                },
            )
        raise AssertionError(f"unexpected provider path: {request.url.path}")

    client = httpx.Client(transport=httpx.MockTransport(handler))
    provider = AmapProvider(
        web_key="fake-web-key",
        home=GeoPoint(latitude=30.1, longitude=120.1),
        city="虚构城市",
        client=client,
    )

    geocoded = provider.geocode("虚构小区 虚构路 1 号")
    assert geocoded == GeoPoint(latitude=30.123456, longitude=120.123456)

    route = provider.plan_route(
        provider.home_point(),  # type: ignore[arg-type]
        [
            RouteStop(
                task_id=1,
                label="虚构站点",
                position=geocoded,
                original_index=0,
            )
        ],
    )
    assert route.distance_meters == 12600
    assert route.duration_seconds == 2880
    assert route.polyline[-1] == geocoded
    assert requests[0].url.params["address"] == "虚构小区 虚构路 1 号"
    assert requests[0].url.params["city"] == "虚构城市"
    assert requests[1].url.params["strategy"] == "10"

    navigation_url = provider.navigation_url(
        provider.home_point(),
        geocoded,
        "虚构站点",
    )
    assert navigation_url.startswith("https://uri.amap.com/navigation?")
    assert "fake-web-key" not in navigation_url
    client.close()


def test_amap_adapter_recommendation_is_stable_and_errors_are_sanitized() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"status": "0", "info": "INVALID_USER_KEY", "infocode": "10001"},
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    provider = AmapProvider(
        web_key="do-not-leak-this-key",
        home=GeoPoint(latitude=30.0, longitude=120.0),
        client=client,
    )
    stops = [
        RouteStop(1, "远点", GeoPoint(30.3, 120.3), 0),
        RouteStop(2, "近点", GeoPoint(30.1, 120.1), 1),
        RouteStop(3, "次近点", GeoPoint(30.2, 120.2), 2),
    ]
    assert [stop.task_id for stop in provider.recommend_order(provider.home_point(), stops)] == [
        2,
        3,
        1,
    ]

    with pytest.raises(MapProviderError) as captured:
        provider.geocode("虚构地址")
    assert "do-not-leak-this-key" not in str(captured.value)
    assert "INVALID_USER_KEY" not in str(captured.value)
    client.close()
