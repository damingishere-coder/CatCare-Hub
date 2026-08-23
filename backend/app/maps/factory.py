import os
from pathlib import Path

from dotenv import load_dotenv

from app.maps.amap import AmapProvider
from app.maps.contracts import (
    GeoPoint,
    MapProviderError,
    MapServices,
    MatrixEntry,
    ProviderState,
    RouteResult,
    RouteStop,
)


PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env", override=False)


class UnavailableMapProvider:
    def __init__(self, provider_name: str, message: str) -> None:
        self._provider_name = provider_name
        self._message = message

    def provider_state(self) -> ProviderState:
        return ProviderState(
            name=self._provider_name,
            configured=False,
            coordinate_system="unknown",
            message=self._message,
        )

    def home_point(self) -> GeoPoint | None:
        return None

    def geocode(self, address: str) -> GeoPoint | None:
        del address
        raise MapProviderError(self._message)

    def plan_route(
        self,
        origin: GeoPoint,
        stops: list[RouteStop],
    ) -> RouteResult:
        del origin, stops
        raise MapProviderError(self._message)

    def recommend_order(
        self,
        origin: GeoPoint,
        stops: list[RouteStop],
    ) -> list[RouteStop]:
        del origin, stops
        raise MapProviderError(self._message)

    def distance_matrix(
        self,
        origin: GeoPoint,
        stops: list[RouteStop],
    ) -> list[MatrixEntry]:
        del origin, stops
        raise MapProviderError(self._message)

    def navigation_url(
        self,
        origin: GeoPoint | None,
        destination: GeoPoint,
        destination_name: str,
    ) -> str:
        del origin, destination, destination_name
        raise MapProviderError(self._message)


def _optional_float(name: str) -> float | None:
    value = os.getenv(name, "").strip()
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _timeout_seconds() -> float:
    value = _optional_float("CATCARE_MAP_TIMEOUT_SECONDS")
    if value is None:
        return 8.0
    return min(max(value, 1.0), 30.0)


def get_map_services() -> MapServices:
    provider_name = os.getenv("CATCARE_MAP_PROVIDER", "disabled").strip().lower()
    if provider_name != "amap":
        message = (
            "地图服务尚未配置；请参考 .env.example 启用高德 Adapter"
            if provider_name in {"", "disabled"}
            else f"当前版本不支持地图 Provider：{provider_name}"
        )
        provider = UnavailableMapProvider(provider_name or "disabled", message)
        return MapServices(provider, provider, provider, provider)

    latitude = _optional_float("CATCARE_HOME_LATITUDE")
    longitude = _optional_float("CATCARE_HOME_LONGITUDE")
    home: GeoPoint | None = None
    if latitude is not None and longitude is not None:
        try:
            home = GeoPoint(latitude=latitude, longitude=longitude)
        except ValueError:
            home = None

    provider = AmapProvider(
        web_key=os.getenv("CATCARE_AMAP_WEB_KEY", ""),
        home=home,
        city=os.getenv("CATCARE_MAP_CITY"),
        timeout_seconds=_timeout_seconds(),
    )
    return MapServices(provider, provider, provider, provider)
