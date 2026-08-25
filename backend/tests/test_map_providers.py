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
        if request.url.path == "/v5/direction/electrobike":
            destination = request.url.params["destination"]
            is_second_stop = destination == "120.200000,30.200000"
            return httpx.Response(
                200,
                json={
                    "status": "1",
                    "route": {
                        "paths": [
                            {
                                "distance": "2000" if is_second_stop else "12600",
                                "cost": {
                                    "duration": "400" if is_second_stop else "2880",
                                },
                                "polyline": (
                                    f"{request.url.params['origin']};"
                                    f"{destination}"
                                ),
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
    assert requests[1].url.path == "/v5/direction/electrobike"
    assert requests[1].url.params["show_fields"] == "cost,navi,polyline"
    assert "strategy" not in requests[1].url.params
    assert "waypoints" not in requests[1].url.params

    multi_stop_route = provider.plan_route(
        provider.home_point(),  # type: ignore[arg-type]
        [
            RouteStop(1, "虚构站点一", geocoded, 0),
            RouteStop(2, "虚构站点二", GeoPoint(30.2, 120.2), 1),
        ],
    )
    assert multi_stop_route.distance_meters == 14600
    assert multi_stop_route.duration_seconds == 3280
    assert multi_stop_route.polyline[0] == provider.home_point()
    assert multi_stop_route.polyline[-1] == GeoPoint(30.2, 120.2)
    route_requests = [
        request
        for request in requests
        if request.url.path == "/v5/direction/electrobike"
    ]
    assert len(route_requests) == 3
    assert route_requests[-1].url.params["origin"] == "120.123456,30.123456"
    assert all(request.url.path != "/v3/direction/driving" for request in requests)
    assert all(request.url.path != "/v3/distance" for request in requests)

    with pytest.raises(MapProviderError, match="不提供批量距离矩阵"):
        provider.distance_matrix(provider.home_point(), [])  # type: ignore[arg-type]

    navigation_url = provider.navigation_url(
        provider.home_point(),
        geocoded,
        "虚构站点",
    )
    assert navigation_url.startswith("https://uri.amap.com/navigation?")
    assert "fake-web-key" not in navigation_url
    assert "mode=ride" in navigation_url
    assert "policy=" not in navigation_url
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
    message = str(captured.value)
    assert "do-not-leak-this-key" not in message
    assert "Web 服务 Key 无效" in message
    assert "INVALID_USER_KEY" in message
    assert "10001" in message
    client.close()
