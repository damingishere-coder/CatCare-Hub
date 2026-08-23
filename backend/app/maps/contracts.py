from dataclasses import dataclass
from math import isfinite
from typing import Protocol


class MapProviderError(RuntimeError):
    """A sanitized provider failure safe to translate into a local API error."""


@dataclass(frozen=True)
class GeoPoint:
    latitude: float
    longitude: float

    def __post_init__(self) -> None:
        if (
            not isfinite(self.latitude)
            or not isfinite(self.longitude)
            or not -90 <= self.latitude <= 90
            or not -180 <= self.longitude <= 180
        ):
            raise ValueError("经纬度超出有效范围")


@dataclass(frozen=True)
class ProviderState:
    name: str
    configured: bool
    coordinate_system: str
    message: str | None = None


@dataclass(frozen=True)
class RouteStop:
    task_id: int
    label: str
    position: GeoPoint
    original_index: int


@dataclass(frozen=True)
class RouteResult:
    distance_meters: int
    duration_seconds: int
    polyline: tuple[GeoPoint, ...]


@dataclass(frozen=True)
class MatrixEntry:
    origin_id: str
    destination_id: str
    distance_meters: int
    duration_seconds: int


class MapProvider(Protocol):
    def provider_state(self) -> ProviderState: ...

    def home_point(self) -> GeoPoint | None: ...


class GeocodeProvider(Protocol):
    def geocode(self, address: str) -> GeoPoint | None: ...


class RouteProvider(Protocol):
    def plan_route(
        self,
        origin: GeoPoint,
        stops: list[RouteStop],
    ) -> RouteResult: ...

    def recommend_order(
        self,
        origin: GeoPoint,
        stops: list[RouteStop],
    ) -> list[RouteStop]: ...

    def distance_matrix(
        self,
        origin: GeoPoint,
        stops: list[RouteStop],
    ) -> list[MatrixEntry]: ...


class NavigationProvider(Protocol):
    def navigation_url(
        self,
        origin: GeoPoint | None,
        destination: GeoPoint,
        destination_name: str,
    ) -> str: ...


@dataclass(frozen=True)
class MapServices:
    map_provider: MapProvider
    geocode_provider: GeocodeProvider
    route_provider: RouteProvider
    navigation_provider: NavigationProvider
