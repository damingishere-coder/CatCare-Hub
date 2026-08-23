from collections.abc import Mapping
from contextlib import nullcontext
from math import cos, radians
from typing import Any
from urllib.parse import urlencode

import httpx

from app.maps.contracts import (
    GeoPoint,
    MapProviderError,
    MatrixEntry,
    ProviderState,
    RouteResult,
    RouteStop,
)


AMAP_API_BASE = "https://restapi.amap.com"
AMAP_NAVIGATION_URL = "https://uri.amap.com/navigation"
MAX_WAYPOINTS_PER_REQUEST = 16
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
    "10020": "服务请求超时",
}


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
    ) -> None:
        self._web_key = web_key.strip()
        self._home = home
        self._city = city.strip() if city else None
        self._timeout_seconds = timeout_seconds
        self._client = client

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
        )

    def home_point(self) -> GeoPoint | None:
        return self._home

    def _request(self, path: str, parameters: Mapping[str, str]) -> dict[str, Any]:
        if not self._web_key:
            raise MapProviderError("地图服务尚未配置")

        request_parameters = {**parameters, "key": self._web_key, "output": "JSON"}
        client_context = (
            nullcontext(self._client)
            if self._client is not None
            else httpx.Client(timeout=self._timeout_seconds)
        )
        try:
            with client_context as client:
                if client is None:
                    raise MapProviderError("地图服务客户端不可用")
                response = client.get(f"{AMAP_API_BASE}{path}", params=request_parameters)
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, ValueError) as cause:
            raise MapProviderError("地图服务暂时不可用，请稍后重试") from cause

        if not isinstance(payload, dict):
            raise MapProviderError("高德返回格式无效")
        if str(payload.get("status")) != "1":
            info = str(payload.get("info") or "UNKNOWN_ERROR")
            infocode = str(payload.get("infocode") or "unknown")
            category = AMAP_ERROR_CATEGORIES.get(infocode, "服务调用失败")
            raise MapProviderError(
                f"高德{category}（{info} / {infocode}）"
            )
        return payload

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

    def geocode(self, address: str) -> GeoPoint | None:
        parameters = {"address": address}
        if self._city:
            parameters["city"] = self._city
        payload = self._request("/v3/geocode/geo", parameters)
        geocodes = payload.get("geocodes")
        if not isinstance(geocodes, list) or not geocodes:
            return None
        first = geocodes[0]
        if not isinstance(first, dict):
            raise MapProviderError("地图服务返回了无效地理编码结果")
        return self._parse_point(first.get("location"))

    @staticmethod
    def _deduplicate_points(points: list[GeoPoint]) -> tuple[GeoPoint, ...]:
        result: list[GeoPoint] = []
        for point in points:
            if result and result[-1] == point:
                continue
            result.append(point)
        return tuple(result)

    def _route_chunk(
        self,
        origin: GeoPoint,
        stops: list[RouteStop],
    ) -> RouteResult:
        destination = stops[-1].position
        parameters = {
            "origin": self._point_value(origin),
            "destination": self._point_value(destination),
            "strategy": "10",
            "extensions": "all",
        }
        if len(stops) > 1:
            parameters["waypoints"] = ";".join(
                self._point_value(stop.position) for stop in stops[:-1]
            )
        payload = self._request("/v3/direction/driving", parameters)
        route = payload.get("route")
        paths = route.get("paths") if isinstance(route, dict) else None
        if not isinstance(paths, list) or not paths or not isinstance(paths[0], dict):
            raise MapProviderError("地图服务没有返回可用驾车路线")
        path = paths[0]
        try:
            distance = int(float(path["distance"]))
            duration = int(float(path["duration"]))
        except (KeyError, TypeError, ValueError) as cause:
            raise MapProviderError("地图服务返回了无效路线指标") from cause

        points = [origin]
        steps = path.get("steps")
        if isinstance(steps, list):
            for step in steps:
                if not isinstance(step, dict) or not step.get("polyline"):
                    continue
                for value in str(step["polyline"]).split(";"):
                    points.append(self._parse_point(value))
        points.append(destination)
        return RouteResult(
            distance_meters=max(distance, 0),
            duration_seconds=max(duration, 0),
            polyline=self._deduplicate_points(points),
        )

    def plan_route(
        self,
        origin: GeoPoint,
        stops: list[RouteStop],
    ) -> RouteResult:
        if not stops:
            return RouteResult(0, 0, (origin,))

        # AMap accepts at most 16 waypoints. Split larger days at a destination
        # boundary while preserving the exact user-provided order.
        maximum_stops = MAX_WAYPOINTS_PER_REQUEST + 1
        current_origin = origin
        remaining = list(stops)
        total_distance = 0
        total_duration = 0
        combined_points: list[GeoPoint] = []
        while remaining:
            chunk = remaining[:maximum_stops]
            remaining = remaining[maximum_stops:]
            chunk_result = self._route_chunk(current_origin, chunk)
            total_distance += chunk_result.distance_meters
            total_duration += chunk_result.duration_seconds
            combined_points.extend(chunk_result.polyline)
            current_origin = chunk[-1].position
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
        """Return a small deterministic nearest-neighbour recommendation.

        This only chooses candidate order. Displayed distance and duration are
        always recalculated by ``plan_route`` using the real driving API.
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
        nodes = [("HOME", origin), *[(str(stop.task_id), stop.position) for stop in stops]]
        entries: list[MatrixEntry] = []
        for destination_id, destination in nodes:
            origins = [node for node in nodes if node[0] != destination_id]
            if not origins:
                continue
            payload = self._request(
                "/v3/distance",
                {
                    "origins": "|".join(
                        self._point_value(point) for _, point in origins
                    ),
                    "destination": self._point_value(destination),
                    "type": "1",
                },
            )
            results = payload.get("results")
            if not isinstance(results, list) or len(results) != len(origins):
                raise MapProviderError("高德距离矩阵返回数量不完整")
            for (origin_id, _), result in zip(origins, results, strict=True):
                if not isinstance(result, dict):
                    raise MapProviderError("高德距离矩阵返回格式无效")
                try:
                    distance = int(float(result["distance"]))
                    duration = int(float(result["duration"]))
                except (KeyError, TypeError, ValueError) as cause:
                    raise MapProviderError("高德距离矩阵返回指标无效") from cause
                entries.append(
                    MatrixEntry(
                        origin_id=origin_id,
                        destination_id=destination_id,
                        distance_meters=max(distance, 0),
                        duration_seconds=max(duration, 0),
                    )
                )
        return entries

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
            "mode": "car",
            "policy": "1",
            "src": "CatCareHub",
            "callnative": "1",
        }
        return f"{AMAP_NAVIGATION_URL}?{urlencode(parameters)}"
