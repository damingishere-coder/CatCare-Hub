from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.maps import MapProviderError, MapServices
from app.models.order import Order
from app.models.task import Task
from app.services.orders import default_geocode_service_area, order_geocode_address


def _normalized(value: str | None) -> str:
    return " ".join((value or "").strip().casefold().split())


def _customer_address(order: Order) -> str | None:
    if order.customer is None:
        return None
    parts = [
        order.customer.address,
        order.customer.community,
        order.customer.building,
    ]
    values: list[str] = []
    for part in parts:
        value = " ".join((part or "").strip().split())
        if value and not any(_normalized(value) in _normalized(item) for item in values):
            values = [item for item in values if _normalized(item) not in _normalized(value)]
            values.append(value)
    return " ".join(values) or None


def clear_order_location(order: Order) -> None:
    order.route_latitude = None
    order.route_longitude = None
    order.route_geocode_status = "pending" if order_geocode_address(order) else "missing"
    for task in order.tasks:
        task.planned_lat = None
        task.planned_lng = None


def geocode_order(session: Session, order_id: int, services: MapServices) -> str:
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

    try:
        point = services.geocode_provider.geocode(address)
    except MapProviderError:
        point = None
    if point is None:
        order.route_latitude = None
        order.route_longitude = None
        order.route_geocode_status = "failed"
        for task in order.tasks:
            task.planned_lat = None
            task.planned_lng = None
        session.commit()
        return "failed"

    latitude = Decimal(str(point.latitude))
    longitude = Decimal(str(point.longitude))
    order.route_latitude = latitude
    order.route_longitude = longitude
    order.route_geocode_status = "resolved"
    for task in order.tasks:
        task.planned_lat = latitude
        task.planned_lng = longitude

    customer_address = default_geocode_service_area(_customer_address(order))
    if order.customer is not None and _normalized(customer_address) == _normalized(address):
        order.customer.latitude = latitude
        order.customer.longitude = longitude
        order.customer.geocode_status = "resolved"
    session.commit()
    return "resolved"
