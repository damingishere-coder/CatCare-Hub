from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.maps import GeoPoint, GeocodeResult, MapProviderError, MapServices
from app.models.customer import Customer
from app.models.enums import OrderStatus
from app.models.order import Order
from app.models.task import Task
from app.schemas.location import LocationUpdateRead
from app.schemas.plan import PlanGeoPoint
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
from app.services.plans import day_plan_revision, load_day_tasks, require_current_revision


def _order_options() -> tuple:
    return (
        selectinload(Order.customer),
        selectinload(Order.tasks).selectinload(Task.items),
        selectinload(Order.tasks).selectinload(Task.photos),
    )


def load_location_order(session: Session, order_id: int) -> Order:
    order = session.scalar(
        select(Order).options(*_order_options()).where(Order.id == order_id)
    )
    if order is None:
        raise HTTPException(status_code=404, detail="订单不存在")
    return order


def _same_moment(current: datetime, expected: datetime) -> bool:
    def normalize(value: datetime) -> datetime:
        if value.tzinfo is not None:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    return normalize(current) == normalize(expected)


def _check_day_revision(session: Session, service_date: date, expected: str) -> list[Task]:
    tasks = load_day_tasks(session, service_date)
    require_current_revision(tasks, expected)
    return tasks


def _point(
    latitude: float | Decimal | None,
    longitude: float | Decimal | None,
) -> PlanGeoPoint | None:
    if latitude is None or longitude is None:
        return None
    return PlanGeoPoint(latitude=float(latitude), longitude=float(longitude))


def _eligible_order(order: Order, address: str) -> bool:
    return (
        order.order_status not in {OrderStatus.CANCELLED, OrderStatus.COMPLETED}
        and normalized_geocode_address(order_geocode_address(order) or "")
        == normalized_geocode_address(address)
    )


def _apply_order_location(
    order: Order,
    *,
    latitude: Decimal,
    longitude: Decimal,
    status: str,
    fingerprint: str,
    adcode: str | None,
    level: str,
) -> int:
    order.route_latitude = latitude
    order.route_longitude = longitude
    order.route_geocode_status = status
    order.route_geocode_fingerprint = fingerprint
    order.route_geocode_adcode = adcode
    order.route_geocode_level = level
    order.updated_at = datetime.now(timezone.utc)
    affected_tasks = 0
    for task in order.tasks:
        if not task_has_execution_history(task):
            task.planned_lat = latitude
            task.planned_lng = longitude
            task.estimated_arrival = None
            affected_tasks += 1
    return affected_tasks


def check_customer_location_concurrency(
    session: Session,
    *,
    customer_id: int,
    source_order_id: int,
    service_date: date,
    expected_customer_updated_at: datetime,
    expected_day_revision: str,
) -> tuple[list[Task], Order, Customer]:
    day_tasks = _check_day_revision(session, service_date, expected_day_revision)
    source_order = load_location_order(session, source_order_id)
    customer = session.scalar(
        select(Customer)
        .options(selectinload(Customer.orders))
        .where(Customer.id == customer_id)
    )
    if customer is None:
        raise HTTPException(status_code=404, detail="客户档案不存在")
    if source_order.customer_id != customer.id:
        raise HTTPException(status_code=409, detail="来源订单与客户档案不匹配")
    source_address = order_geocode_address(source_order)
    current_customer_address = customer_geocode_address(customer)
    if (
        not source_address
        or normalized_geocode_address(source_address)
        != normalized_geocode_address(current_customer_address or "")
    ):
        raise HTTPException(status_code=409, detail="来源订单地址与客户当前地址不一致")
    if not _same_moment(customer.updated_at, expected_customer_updated_at):
        raise HTTPException(status_code=409, detail="客户档案已经变化，请刷新后再修改定位")
    return day_tasks, source_order, customer


def check_order_location_concurrency(
    session: Session,
    *,
    order_id: int,
    service_date: date,
    expected_order_updated_at: datetime,
    expected_day_revision: str,
) -> tuple[list[Task], Order]:
    day_tasks = _check_day_revision(session, service_date, expected_day_revision)
    order = load_location_order(session, order_id)
    if order.customer_id is not None:
        raise HTTPException(status_code=409, detail="该订单已关联客户档案，请修改客户定位")
    if not _same_moment(order.updated_at, expected_order_updated_at):
        raise HTTPException(status_code=409, detail="订单已经变化，请刷新后再修改定位")
    return day_tasks, order


def update_customer_location(
    session: Session,
    *,
    customer_id: int,
    source_order_id: int,
    service_date: date,
    expected_customer_updated_at: datetime,
    expected_day_revision: str,
    latitude: float,
    longitude: float,
    automatic_result: GeocodeResult | None = None,
    provider_name: str = "manual",
) -> LocationUpdateRead:
    day_tasks, source_order, customer = check_customer_location_concurrency(
        session,
        customer_id=customer_id,
        source_order_id=source_order_id,
        service_date=service_date,
        expected_customer_updated_at=expected_customer_updated_at,
        expected_day_revision=expected_day_revision,
    )
    address = order_geocode_address(source_order)
    if not address:
        raise HTTPException(status_code=422, detail="订单缺少可定位地址")
    original = _point(customer.latitude, customer.longitude)
    lat = Decimal(str(latitude))
    lng = Decimal(str(longitude))
    status = "resolved" if automatic_result is not None else "manual"
    fingerprint = geocode_fingerprint(provider_name, address)
    adcode = automatic_result.adcode if automatic_result is not None else None
    level = automatic_result.level if automatic_result is not None else "manual_pin"
    customer.latitude = lat
    customer.longitude = lng
    customer.geocode_status = status
    customer.geocode_fingerprint = fingerprint
    customer.geocode_adcode = adcode
    customer.geocode_level = level
    customer.updated_at = datetime.now(timezone.utc)

    orders = list(
        session.scalars(
            select(Order)
            .options(*_order_options())
            .where(Order.customer_id == customer.id)
        )
        .unique()
        .all()
    )
    affected_orders = 0
    affected_tasks = 0
    for order in orders:
        if not _eligible_order(order, address):
            continue
        affected_tasks += _apply_order_location(
            order,
            latitude=lat,
            longitude=lng,
            status=status,
            fingerprint=fingerprint,
            adcode=adcode,
            level=level,
        )
        affected_orders += 1
    session.flush()
    return LocationUpdateRead(
        scope="customer",
        customer_id=customer.id,
        order_id=source_order.id,
        original_position=original,
        position=PlanGeoPoint(latitude=latitude, longitude=longitude),
        affected_orders=affected_orders,
        affected_tasks=affected_tasks,
        customer_updated_at=customer.updated_at,
        order_updated_at=source_order.updated_at,
        day_revision=day_plan_revision(day_tasks),
    )


def update_order_location(
    session: Session,
    *,
    order_id: int,
    service_date: date,
    expected_order_updated_at: datetime,
    expected_day_revision: str,
    latitude: float,
    longitude: float,
    automatic_result: GeocodeResult | None = None,
    provider_name: str = "manual",
) -> LocationUpdateRead:
    day_tasks, order = check_order_location_concurrency(
        session,
        order_id=order_id,
        service_date=service_date,
        expected_order_updated_at=expected_order_updated_at,
        expected_day_revision=expected_day_revision,
    )
    address = order_geocode_address(order)
    if not address:
        raise HTTPException(status_code=422, detail="订单缺少可定位地址")
    original = _point(order.route_latitude, order.route_longitude)
    lat = Decimal(str(latitude))
    lng = Decimal(str(longitude))
    status = "resolved" if automatic_result is not None else "manual"
    fingerprint = geocode_fingerprint(provider_name, address)
    affected_tasks = _apply_order_location(
        order,
        latitude=lat,
        longitude=lng,
        status=status,
        fingerprint=fingerprint,
        adcode=automatic_result.adcode if automatic_result is not None else None,
        level=automatic_result.level if automatic_result is not None else "manual_pin",
    )
    session.flush()
    return LocationUpdateRead(
        scope="order",
        customer_id=None,
        order_id=order.id,
        original_position=original,
        position=PlanGeoPoint(latitude=latitude, longitude=longitude),
        affected_orders=1,
        affected_tasks=affected_tasks,
        customer_updated_at=None,
        order_updated_at=order.updated_at,
        day_revision=day_plan_revision(day_tasks),
    )


def verified_geocode(order: Order, services: MapServices) -> tuple[GeocodeResult, str]:
    address = order_geocode_address(order)
    if not address:
        raise HTTPException(status_code=422, detail="订单缺少可定位地址")
    try:
        result = services.geocode_provider.geocode(address)
    except MapProviderError as exc:
        raise HTTPException(status_code=409, detail="地址自动定位失败，已保留原手动锚点") from exc
    if result is None or not geocode_result_matches_address(address, result):
        raise HTTPException(status_code=409, detail="地址自动定位未通过验证，已保留原手动锚点")
    return result, services.map_provider.provider_state().name


def location_impact(session: Session, order: Order) -> tuple[str, int, int, datetime | None]:
    if order.customer_id is None:
        return (
            "order",
            1,
            sum(1 for task in order.tasks if not task_has_execution_history(task)),
            None,
        )
    customer = session.get(Customer, order.customer_id)
    address = order_geocode_address(order)
    if customer is None or not address:
        return ("order", 1, 0, customer.updated_at if customer else None)
    orders = list(
        session.scalars(
            select(Order).options(*_order_options()).where(Order.customer_id == customer.id)
        ).unique().all()
    )
    eligible = [candidate for candidate in orders if _eligible_order(candidate, address)]
    return (
        "customer",
        len(eligible),
        sum(
            1
            for candidate in eligible
            for task in candidate.tasks
            if not task_has_execution_history(task)
        ),
        customer.updated_at,
    )
