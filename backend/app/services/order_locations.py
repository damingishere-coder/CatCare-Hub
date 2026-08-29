from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.maps import GeoPoint, GeocodeResult, MapProviderError, MapServices
from app.models.order import Order
from app.models.task import Task
from app.services.geocoding import (
    geocode_fingerprint,
    geocode_result_matches_address,
    normalized_geocode_address,
)
from app.services.orders import (
    customer_geocode_address,
    order_geocode_address,
    task_has_execution_history,
)


def clear_order_location(order: Order) -> None:
    order.route_latitude = None
    order.route_longitude = None
    order.route_geocode_status = "pending" if order_geocode_address(order) else "missing"
    order.route_geocode_fingerprint = None
    order.route_geocode_adcode = None
    order.route_geocode_level = None
    for task in order.tasks:
        if not task_has_execution_history(task):
            task.planned_lat = None
            task.planned_lng = None


def trusted_order_point(order: Order, services: MapServices) -> GeoPoint | None:
    address = order_geocode_address(order)
    if (
        address
        and order.route_geocode_status == "manual"
        and order.route_geocode_fingerprint == geocode_fingerprint("manual", address)
        and order.route_latitude is not None
        and order.route_longitude is not None
    ):
        try:
            return GeoPoint(
                latitude=float(order.route_latitude),
                longitude=float(order.route_longitude),
            )
        except (TypeError, ValueError):
            return None
    state = services.map_provider.provider_state()
    expected_fingerprints = (
        {geocode_fingerprint(state.name, address)} if address else set()
    )
    if address and not state.configured:
        # A disabled provider must not make an arbitrary non-empty fingerprint
        # trustworthy. AMap is the only persisted geocoder supported today, so
        # its cached fingerprint can still be verified without a live request.
        expected_fingerprints.add(geocode_fingerprint("amap", address))
    fingerprint_matches = order.route_geocode_fingerprint in expected_fingerprints
    if (
        order.route_geocode_status != "resolved"
        or not fingerprint_matches
        or order.route_latitude is None
        or order.route_longitude is None
    ):
        return None
    try:
        return GeoPoint(
            latitude=float(order.route_latitude),
            longitude=float(order.route_longitude),
        )
    except (TypeError, ValueError):
        return None


def _mark_geocode_failure(
    order: Order,
    *,
    status: str,
    result: GeocodeResult | None = None,
) -> None:
    order.route_geocode_status = status
    if result is not None:
        order.route_geocode_adcode = result.adcode
        order.route_geocode_level = result.level


def _apply_geocode_result(
    order: Order,
    *,
    address: str,
    result: GeocodeResult,
    services: MapServices,
) -> None:
    latitude = Decimal(str(result.point.latitude))
    longitude = Decimal(str(result.point.longitude))
    fingerprint = geocode_fingerprint(
        services.map_provider.provider_state().name,
        address,
    )
    order.route_latitude = latitude
    order.route_longitude = longitude
    order.route_geocode_status = "resolved"
    order.route_geocode_fingerprint = fingerprint
    order.route_geocode_adcode = result.adcode
    order.route_geocode_level = result.level
    for task in order.tasks:
        if not task_has_execution_history(task):
            task.planned_lat = latitude
            task.planned_lng = longitude

    customer_address = (
        customer_geocode_address(order.customer) if order.customer is not None else None
    )
    if (
        order.customer is not None
        and normalized_geocode_address(customer_address or "")
        == normalized_geocode_address(address)
    ):
        order.customer.latitude = latitude
        order.customer.longitude = longitude
        order.customer.geocode_status = "resolved"
        order.customer.geocode_fingerprint = fingerprint
        order.customer.geocode_adcode = result.adcode
        order.customer.geocode_level = result.level


def geocode_order(
    session: Session,
    order_id: int,
    services: MapServices,
    *,
    raise_provider_errors: bool = False,
    prefer_customer_manual: bool = True,
) -> str:
    """Best-effort address-only geocoding after the order transaction succeeds."""

    order = session.scalar(
        select(Order)
        .where(Order.id == order_id)
        .options(selectinload(Order.customer), selectinload(Order.tasks))
    )
    if order is None:
        return "missing_order"
    address = order_geocode_address(order)
    if not address:
        clear_order_location(order)
        session.commit()
        return "missing"

    customer = order.customer
    if (
        prefer_customer_manual
        and customer is not None
        and customer.geocode_status == "manual"
        and customer.geocode_fingerprint == geocode_fingerprint("manual", address)
        and customer.latitude is not None
        and customer.longitude is not None
    ):
        order.route_latitude = customer.latitude
        order.route_longitude = customer.longitude
        order.route_geocode_status = "manual"
        order.route_geocode_fingerprint = customer.geocode_fingerprint
        order.route_geocode_adcode = None
        order.route_geocode_level = "manual_pin"
        for task in order.tasks:
            if not task_has_execution_history(task):
                task.planned_lat = customer.latitude
                task.planned_lng = customer.longitude
        session.commit()
        return "manual"

    try:
        result = services.geocode_provider.geocode(address)
    except MapProviderError:
        _mark_geocode_failure(order, status="failed")
        session.commit()
        if raise_provider_errors:
            raise
        return "failed"
    if result is None:
        _mark_geocode_failure(order, status="failed")
        session.commit()
        return "failed"

    if not geocode_result_matches_address(address, result):
        _mark_geocode_failure(order, status="geocode_mismatch", result=result)
        session.commit()
        return "geocode_mismatch"

    _apply_geocode_result(order, address=address, result=result, services=services)
    session.commit()
    return "resolved"
