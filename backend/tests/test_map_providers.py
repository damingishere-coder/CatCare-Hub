import httpx
import pytest
from threading import Lock
import time

from app.maps import GeoPoint, GeocodeResult, MapProviderError, RouteStop
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
                    "geocodes": [{
                        "location": "120.123456,30.123456",
                        "city": "杭州市",
                        "district": "上城区",
                        "adcode": "330102",
                        "level": "门牌号",
                    }],
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
        route_request_interval_seconds=0,
    )

    geocoded = provider.geocode("虚构小区 虚构路 1 号")
    assert geocoded == GeocodeResult(
        point=GeoPoint(latitude=30.123456, longitude=120.123456),
        city="杭州市",
        district="上城区",
        adcode="330102",
        level="门牌号",
    )

    route = provider.plan_route(
        provider.home_point(),  # type: ignore[arg-type]
        [
            RouteStop(
                task_id=1,
                label="虚构站点",
                position=geocoded.point,
                original_index=0,
            )
        ],
    )
    assert route.distance_meters == 12600
    assert route.duration_seconds == 2880
    assert route.polyline[-1] == geocoded.point
    assert requests[0].url.params["address"] == "虚构小区 虚构路 1 号"
    assert requests[0].url.params["city"] == "虚构城市"
    assert requests[1].url.path == "/v5/direction/electrobike"
    assert requests[1].url.params["show_fields"] == "cost,navi,polyline"
    assert "strategy" not in requests[1].url.params
    assert "waypoints" not in requests[1].url.params

    multi_stop_route = provider.plan_route(
        provider.home_point(),  # type: ignore[arg-type]
        [
            RouteStop(1, "虚构站点一", geocoded.point, 0),
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
    assert len(route_requests) == 2
    assert route_requests[-1].url.params["origin"] == "120.123456,30.123456"
    assert all(request.url.path != "/v3/direction/driving" for request in requests)
    assert all(request.url.path != "/v3/distance" for request in requests)

    with pytest.raises(MapProviderError, match="不提供批量距离矩阵"):
        provider.distance_matrix(provider.home_point(), [])  # type: ignore[arg-type]

    navigation_url = provider.navigation_url(
        provider.home_point(),
        geocoded.point,
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


def test_amap_geocode_uses_explicit_external_city_instead_of_default_city() -> None:
    requested_cities: list[str | None] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested_cities.append(request.url.params.get("city"))
        return httpx.Response(
            200,
            json={
                "status": "1",
                "geocodes": [{
                    "location": "113.264385,23.129112",
                    "city": "广州市",
                    "district": "越秀区",
                    "adcode": "440104",
                    "level": "门牌号",
                }],
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    provider = AmapProvider(
        web_key="test-key",
        home=GeoPoint(22.62, 114.05),
        city="深圳市",
        client=client,
    )

    result = provider.geocode("广州市越秀区中山五路1号")

    assert result is not None
    assert result.city == "广州市"
    assert requested_cities == ["广州市"]
    client.close()


def test_amap_retries_only_transient_failures() -> None:
    attempts = 0
    delays: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            return httpx.Response(503, request=request)
        return httpx.Response(
            200,
            json={
                "status": "1",
                "geocodes": [{
                    "location": "114.054397,22.630841",
                    "city": "深圳市",
                    "district": "龙岗区",
                    "adcode": "440307",
                    "level": "门牌号",
                }],
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    provider = AmapProvider(
        web_key="test-key",
        home=GeoPoint(22.62, 114.05),
        client=client,
        sleep=delays.append,
    )

    result = provider.geocode("深圳市龙岗区长坑三巷21号")

    assert result is not None
    assert result.point == GeoPoint(22.630841, 114.054397)
    assert attempts == 3
    assert len(delays) == 2
    assert delays == [0.5, 1.5]
    client.close()


@pytest.mark.parametrize("infocode", ["10016", "10020"])
def test_amap_retries_transient_business_errors(infocode: str) -> None:
    attempts = 0
    delays: list[float] = []

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            return httpx.Response(
                200,
                json={
                    "status": "0",
                    "info": "SERVICE_BUSY",
                    "infocode": infocode,
                },
            )
        return httpx.Response(
            200,
            json={
                "status": "1",
                "geocodes": [{
                    "location": "114.054397,22.630841",
                    "city": "深圳市",
                    "district": "龙岗区",
                    "adcode": "440307",
                    "level": "门牌号",
                }],
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    provider = AmapProvider(
        web_key="test-key",
        home=GeoPoint(22.62, 114.05),
        client=client,
        sleep=delays.append,
    )

    assert provider.geocode("深圳市龙岗区长坑三巷21号") is not None
    assert attempts == 3
    assert delays == [0.5, 1.5]
    client.close()


@pytest.mark.parametrize(
    ("infocode", "info", "message"),
    [
        ("30007", "RESULTS_ARE_EMPTY", "坐标异常"),
        ("10021", "CUQPS_HAS_EXCEEDED_THE_LIMIT", "降低并发"),
    ],
)
def test_amap_does_not_retry_permanent_route_errors(
    infocode: str,
    info: str,
    message: str,
) -> None:
    attempts = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        return httpx.Response(
            200,
            json={
                "status": "0",
                "info": info,
                "infocode": infocode,
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    provider = AmapProvider(
        web_key="test-key",
        home=GeoPoint(22.62, 114.05),
        client=client,
        sleep=lambda _: None,
    )

    with pytest.raises(MapProviderError, match=message):
        provider.plan_route(
            GeoPoint(22.62, 114.05),
            [RouteStop(1, "测试地点", GeoPoint(22.63, 114.06), 0)],
        )

    assert attempts == 1
    client.close()


def test_amap_route_leg_cache_reuses_successful_result() -> None:
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        return httpx.Response(
            200,
            json={
                "status": "1",
                "route": {
                    "paths": [{
                        "distance": "692",
                        "cost": {"duration": "182"},
                        "polyline": (
                            f"{request.url.params['origin']};"
                            f"{request.url.params['destination']}"
                        ),
                    }],
                },
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    provider = AmapProvider(
        web_key="test-key",
        home=GeoPoint(22.62, 114.05),
        client=client,
    )
    stops = [RouteStop(1, "测试地点", GeoPoint(22.63, 114.06), 0)]

    assert provider.plan_route(GeoPoint(22.62, 114.05), stops).distance_meters == 692
    assert provider.plan_route(GeoPoint(22.62, 114.05), stops).distance_meters == 692
    assert attempts == 1
    client.close()


def test_amap_route_cache_honors_capacity_and_ttl() -> None:
    attempts = 0
    now = [0.0]

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        return httpx.Response(
            200,
            json={
                "status": "1",
                "route": {
                    "paths": [{
                        "distance": "100",
                        "cost": {"duration": "30"},
                        "polyline": (
                            f"{request.url.params['origin']};"
                            f"{request.url.params['destination']}"
                        ),
                    }],
                },
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    provider = AmapProvider(
        web_key="test-key",
        home=GeoPoint(22.60, 114.00),
        client=client,
        route_cache_ttl_seconds=900,
        route_cache_max_entries=1,
        route_request_interval_seconds=0,
        clock=lambda: now[0],
    )
    first = [RouteStop(1, "地点一", GeoPoint(22.61, 114.01), 0)]
    second = [RouteStop(2, "地点二", GeoPoint(22.62, 114.02), 0)]

    provider.plan_route(GeoPoint(22.60, 114.00), first)
    provider.plan_route(GeoPoint(22.60, 114.00), first)
    assert attempts == 1

    provider.plan_route(GeoPoint(22.60, 114.00), second)
    provider.plan_route(GeoPoint(22.60, 114.00), first)
    assert attempts == 3

    now[0] = 901.0
    provider.plan_route(GeoPoint(22.60, 114.00), first)
    assert attempts == 4
    client.close()


def test_amap_limits_concurrent_route_legs_to_two() -> None:
    lock = Lock()
    active = 0
    maximum_active = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal active, maximum_active
        with lock:
            active += 1
            maximum_active = max(maximum_active, active)
        time.sleep(0.05)
        with lock:
            active -= 1
        return httpx.Response(
            200,
            json={
                "status": "1",
                "route": {
                    "paths": [{
                        "distance": "100",
                        "cost": {"duration": "30"},
                        "polyline": (
                            f"{request.url.params['origin']};"
                            f"{request.url.params['destination']}"
                        ),
                    }],
                },
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    provider = AmapProvider(
        web_key="test-key",
        home=GeoPoint(22.60, 114.00),
        client=client,
        max_route_workers=2,
        route_request_interval_seconds=0,
    )
    route = provider.plan_route(
        GeoPoint(22.60, 114.00),
        [
            RouteStop(1, "地点一", GeoPoint(22.61, 114.01), 0),
            RouteStop(2, "地点二", GeoPoint(22.62, 114.02), 1),
            RouteStop(3, "地点三", GeoPoint(22.63, 114.03), 2),
        ],
    )

    assert route.distance_meters == 300
    assert maximum_active == 2
    client.close()
