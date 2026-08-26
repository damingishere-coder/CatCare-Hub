from collections import OrderedDict
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from contextlib import nullcontext
from math import cos, radians
import logging
import re
from threading import Lock
import time
from typing import Any
from urllib.parse import urlencode

import httpx

from app.maps.contracts import (
    GeoPoint,
    GeocodeResult,
    MapProviderError,
    MatrixEntry,
    ProviderState,
    RouteResult,
    RouteStop,
)


AMAP_API_BASE = "https://restapi.amap.com"
AMAP_NAVIGATION_URL = "https://uri.amap.com/navigation"
AMAP_ERROR_CATEGORIES = {
    "10001": "Web 服务 Key 无效",
    "10002": "Key 未开通当前服务",
    "10003": "调用配额已用尽",
    "10004": "调用过于频繁",
    "10005": "IP 白名单不匹配",
    "10006": "域名白名单不匹配",
    "10007": "数字签名无效",
    "10009": "Key 类型与服务平台不匹配",
    "10010": "IP 调用超限",
    "10012": "Key 权限不足",
    "10016": "服务端繁忙",
    "10020": "Key 的接口 QPS 超出限制",
    "10021": "账号的接口 QPS 超出限制，请降低并发后再试",
    "30007": "未找到可用路线，通常是坐标异常",
}
TRANSIENT_INFOCODES = {"10016", "10020"}
TRANSIENT_HTTP_STATUSES = {502, 503, 504}
_CITY_PATTERN = re.compile(r"(?:^|省|\s)([^省区县乡镇街道路\s]{2,8}市)")
LOGGER = logging.getLogger("catcare.maps.amap")


class AmapProvider:
    """High-level adapter around AMap Web Service and URI APIs."""

    def __init__(
        self,
        *,
        web_key: str,
        home: GeoPoint | None,
        city: str | None = None,
        timeout_seconds: float = 8.0,
        client: httpx.Client | None = None,
        max_route_workers: int = 2,
        route_budget_seconds: float = 40.0,
        route_cache_ttl_seconds: float = 900.0,
        route_cache_max_entries: int = 512,
        route_request_interval_seconds: float = 1.05,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._web_key = web_key.strip()
        self._home = home
        self._city = city.strip() if city else None
        self._timeout_seconds = timeout_seconds
        self._client = client or httpx.Client(timeout=self._timeout_seconds)
        self._max_route_workers = max(1, max_route_workers)
        self._route_budget_seconds = max(1.0, route_budget_seconds)
        self._route_cache_ttl_seconds = max(0.0, route_cache_ttl_seconds)
        self._route_cache_max_entries = max(1, route_cache_max_entries)
        self._route_cache: OrderedDict[
            tuple[float, float, float, float], tuple[float, RouteResult]
        ] = OrderedDict()
        self._route_cache_lock = Lock()
        self._route_request_interval_seconds = max(
            0.0,
            route_request_interval_seconds,
        )
        self._route_request_lock = Lock()
        self._next_route_request_at = 0.0
        self._sleep = sleep
        self._clock = clock

    def provider_state(self) -> ProviderState:
        missing: list[str] = []
        if not self._web_key:
            missing.append("高德 Web 服务 Key")
        if self._home is None:
            missing.append("家庭起点坐标")
        return ProviderState(
            name="amap",
            configured=not missing,
            coordinate_system="GCJ-02",
            message=f"请在本机 .env 配置{'和'.join(missing)}" if missing else None,
            transport_mode="electrobike",
        )

    def home_point(self) -> GeoPoint | None:
        return self._home

    def _retry_delay(self, attempt: int, deadline: float | None) -> None:
        delay = 0.5 if attempt == 0 else 1.5
        if deadline is not None:
            remaining = deadline - self._clock()
            if remaining <= 0:
                raise MapProviderError("高德请求超过路线计算时间预算")
            delay = min(delay, remaining)
        self._sleep(delay)

    def _request(
        self,
        path: str,
        parameters: Mapping[str, str],
        *,
        client: httpx.Client | None = None,
        deadline: float | None = None,
    ) -> dict[str, Any]:
        if not self._web_key:
            raise MapProviderError("地图服务尚未配置")

        request_parameters = {**parameters, "key": self._web_key, "output": "JSON"}
        selected_client = client or self._client
        for attempt in range(3):
            if deadline is not None and self._clock() >= deadline:
                raise MapProviderError("高德请求超过路线计算时间预算")
            client_context = (
                nullcontext(selected_client)
                if selected_client is not None
                else httpx.Client(timeout=self._timeout_seconds)
            )
            try:
                with client_context as request_client:
                    if request_client is None:
                        raise MapProviderError("地图服务客户端不可用")
                    request_timeout = self._timeout_seconds
                    if deadline is not None:
                        request_timeout = min(
                            request_timeout,
                            max(0.001, deadline - self._clock()),
                        )
                    response = request_client.get(
                        f"{AMAP_API_BASE}{path}",
                        params=request_parameters,
                        timeout=request_timeout,
                    )
                    response.raise_for_status()
                    payload = response.json()
            except httpx.HTTPStatusError as cause:
                status_code = cause.response.status_code
                if status_code in TRANSIENT_HTTP_STATUSES and attempt < 2:
                    LOGGER.warning(
                        "高德请求瞬时 HTTP 失败，准备重试 path=%s status=%s attempt=%s",
                        path,
                        status_code,
                        attempt + 1,
                    )
                    self._retry_delay(attempt, deadline)
                    continue
                if status_code == 429:
                    raise MapProviderError("高德调用过于频繁，请稍后再试") from cause
                raise MapProviderError(
                    f"地图服务 HTTP 请求失败（{status_code}）"
                ) from cause
            except (httpx.TimeoutException, httpx.TransportError, ValueError) as cause:
                if attempt < 2:
                    LOGGER.warning(
                        "高德请求网络失败，准备重试 path=%s error=%s attempt=%s",
                        path,
                        type(cause).__name__,
                        attempt + 1,
                    )
                    self._retry_delay(attempt, deadline)
                    continue
                raise MapProviderError("地图服务暂时不可用，请稍后重试") from cause

            if not isinstance(payload, dict):
                raise MapProviderError("高德返回格式无效")
            if str(payload.get("status")) == "1":
                return payload

            info = str(payload.get("info") or "UNKNOWN_ERROR")
            infocode = str(payload.get("infocode") or "unknown")
            if infocode in TRANSIENT_INFOCODES and attempt < 2:
                LOGGER.warning(
                    "高德请求瞬时业务失败，准备重试 path=%s infocode=%s attempt=%s",
                    path,
                    infocode,
                    attempt + 1,
                )
                self._retry_delay(attempt, deadline)
                continue
            category = AMAP_ERROR_CATEGORIES.get(infocode, "服务调用失败")
            raise MapProviderError(f"高德{category}（{info} / {infocode}）")

        raise MapProviderError("地图服务暂时不可用，请稍后重试")

    @staticmethod
    def _parse_point(value: object) -> GeoPoint:
        if not isinstance(value, str):
            raise MapProviderError("地图服务返回了无效坐标")
        parts = value.split(",")
        if len(parts) != 2:
            raise MapProviderError("地图服务返回了无效坐标")
        try:
            return GeoPoint(latitude=float(parts[1]), longitude=float(parts[0]))
        except ValueError as cause:
            raise MapProviderError("地图服务返回了无效坐标") from cause

    @staticmethod
    def _point_value(point: GeoPoint) -> str:
        return f"{point.longitude:.6f},{point.latitude:.6f}"

    @staticmethod
    def _optional_text(value: object) -> str | None:
        return value.strip() if isinstance(value, str) and value.strip() else None

    def geocode(self, address: str) -> GeocodeResult | None:
        parameters = {"address": address}
        address_city = _CITY_PATTERN.search(address)
        selected_city = address_city.group(1) if address_city else self._city
        if selected_city:
            parameters["city"] = selected_city
        payload = self._request("/v3/geocode/geo", parameters)
        geocodes = payload.get("geocodes")
        if not isinstance(geocodes, list) or not geocodes:
            return None
        first = geocodes[0]
        if not isinstance(first, dict):
            raise MapProviderError("地图服务返回了无效地理编码结果")
        return GeocodeResult(
            point=self._parse_point(first.get("location")),
            city=self._optional_text(first.get("city")),
            district=self._optional_text(first.get("district")),
            adcode=self._optional_text(first.get("adcode")),
            level=self._optional_text(first.get("level")),
        )

    @staticmethod
    def _deduplicate_points(points: list[GeoPoint]) -> tuple[GeoPoint, ...]:
        result: list[GeoPoint] = []
        for point in points:
            if result and result[-1] == point:
                continue
            result.append(point)
        return tuple(result)

    def _route_leg(
        self,
        origin: GeoPoint,
        destination: GeoPoint,
        *,
        client: httpx.Client | None = None,
        deadline: float | None = None,
    ) -> RouteResult:
        key = (
            round(origin.latitude, 6),
            round(origin.longitude, 6),
            round(destination.latitude, 6),
            round(destination.longitude, 6),
        )
        now = self._clock()
        with self._route_cache_lock:
            cached = self._route_cache.get(key)
            if cached is not None and cached[0] > now:
                self._route_cache.move_to_end(key)
                return cached[1]
            if cached is not None:
                self._route_cache.pop(key, None)

        with self._route_request_lock:
            now = self._clock()
            request_at = max(now, self._next_route_request_at)
            if deadline is not None and request_at >= deadline:
                raise MapProviderError("高德请求超过路线计算时间预算")
            self._next_route_request_at = (
                request_at + self._route_request_interval_seconds
            )
        wait_seconds = request_at - now
        if wait_seconds > 0:
            self._sleep(wait_seconds)

        parameters = {
            "origin": self._point_value(origin),
            "destination": self._point_value(destination),
            "show_fields": "cost,navi,polyline",
        }
        payload = self._request(
            "/v5/direction/electrobike",
            parameters,
            client=client,
            deadline=deadline,
        )
        route = payload.get("route")
        paths = route.get("paths") if isinstance(route, dict) else None
        if not isinstance(paths, list) or not paths or not isinstance(paths[0], dict):
            raise MapProviderError("地图服务没有返回可用电动车路线")
        path = paths[0]
        cost = path.get("cost")
        duration_value = cost.get("duration") if isinstance(cost, dict) else None
        if duration_value is None:
            duration_value = path.get("duration")
        try:
            distance = int(float(path["distance"]))
            duration = int(float(duration_value))
        except (KeyError, TypeError, ValueError) as cause:
            raise MapProviderError("地图服务返回了无效路线指标") from cause

        points = [origin]
        path_polyline = path.get("polyline")
        if path_polyline:
            for value in str(path_polyline).split(";"):
                points.append(self._parse_point(value))
        else:
            steps = path.get("steps")
            if isinstance(steps, list):
                for step in steps:
                    if not isinstance(step, dict) or not step.get("polyline"):
                        continue
                    for value in str(step["polyline"]).split(";"):
                        points.append(self._parse_point(value))
        points.append(destination)
        result = RouteResult(
            distance_meters=max(distance, 0),
            duration_seconds=max(duration, 0),
            polyline=self._deduplicate_points(points),
        )
        if self._route_cache_ttl_seconds:
            with self._route_cache_lock:
                self._route_cache[key] = (
                    self._clock() + self._route_cache_ttl_seconds,
                    result,
                )
                self._route_cache.move_to_end(key)
                while len(self._route_cache) > self._route_cache_max_entries:
                    self._route_cache.popitem(last=False)
        return result

    def plan_route(
        self,
        origin: GeoPoint,
        stops: list[RouteStop],
    ) -> RouteResult:
        if not stops:
            return RouteResult(0, 0, (origin,))

        points = [origin, *(stop.position for stop in stops)]
        legs = list(zip(points, points[1:]))
        deadline = self._clock() + self._route_budget_seconds
        client_context = (
            nullcontext(self._client)
            if self._client is not None
            else httpx.Client(timeout=self._timeout_seconds)
        )
        try:
            with client_context as route_client:
                if route_client is None:
                    raise MapProviderError("地图服务客户端不可用")
                with ThreadPoolExecutor(
                    max_workers=min(self._max_route_workers, len(legs))
                ) as executor:
                    futures = [
                        executor.submit(
                            self._route_leg,
                            leg_origin,
                            leg_destination,
                            client=route_client,
                            deadline=deadline,
                        )
                        for leg_origin, leg_destination in legs
                    ]
                    leg_results = []
                    for future in futures:
                        remaining = deadline - self._clock()
                        if remaining <= 0:
                            raise MapProviderError("高德电动车路线计算超过 40 秒")
                        leg_results.append(future.result(timeout=remaining))
        except FutureTimeout as cause:
            raise MapProviderError("高德电动车路线计算超过 40 秒") from cause

        total_distance = 0
        total_duration = 0
        combined_points: list[GeoPoint] = []
        for leg_result in leg_results:
            total_distance += leg_result.distance_meters
            total_duration += leg_result.duration_seconds
            combined_points.extend(leg_result.polyline)
        return RouteResult(
            distance_meters=total_distance,
            duration_seconds=total_duration,
            polyline=self._deduplicate_points(combined_points),
        )

    @staticmethod
    def _distance_score(origin: GeoPoint, destination: GeoPoint) -> float:
        mean_latitude = radians((origin.latitude + destination.latitude) / 2)
        latitude_delta = destination.latitude - origin.latitude
        longitude_delta = (destination.longitude - origin.longitude) * cos(mean_latitude)
        return latitude_delta * latitude_delta + longitude_delta * longitude_delta

    def recommend_order(
        self,
        origin: GeoPoint,
        stops: list[RouteStop],
    ) -> list[RouteStop]:
        """Return a deterministic nearest-neighbour candidate order.

        Displayed metrics are always recalculated by ``plan_route`` using the
        real electric-bicycle road API.
        """

        remaining = list(stops)
        recommended: list[RouteStop] = []
        current = origin
        while remaining:
            next_stop = min(
                remaining,
                key=lambda stop: (
                    self._distance_score(current, stop.position),
                    stop.original_index,
                    stop.task_id,
                ),
            )
            recommended.append(next_stop)
            remaining.remove(next_stop)
            current = next_stop.position
        return recommended

    def distance_matrix(
        self,
        origin: GeoPoint,
        stops: list[RouteStop],
    ) -> list[MatrixEntry]:
        del origin, stops
        raise MapProviderError("电动车路线不提供批量距离矩阵")

    def navigation_url(
        self,
        origin: GeoPoint | None,
        destination: GeoPoint,
        destination_name: str,
    ) -> str:
        parameters = {
            "from": (
                f"{self._point_value(origin)},家" if origin is not None else ""
            ),
            "to": f"{self._point_value(destination)},{destination_name}",
            "mode": "ride",
            "src": "CatCareHub",
            "callnative": "1",
        }
        return f"{AMAP_NAVIGATION_URL}?{urlencode(parameters)}"
