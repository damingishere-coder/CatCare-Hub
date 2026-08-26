import re
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException

from app.models.customer import Cat, Customer
from app.models.enums import (
    OrderAdjustmentType,
    OrderPaymentStatus,
    OrderSettlementMode,
    OrderStatus,
    PaymentRecordStatus,
    TaskItemType,
    TaskStatus,
)
from app.models.order import Order, OrderCat, OrderServiceDate
from app.models.task import Task, TaskItem
from app.schemas.order import (
    OrderAmountAdjustment,
    OrderCreate,
    OrderServiceContact,
    OrderWrite,
)


MONEY = Decimal("0.01")
DEFAULT_BASE_PRICE = Decimal("30.00")
EXTRA_CAT_UNIT_PRICE = Decimal("5.00")
STAIRS_UNIT_PRICE = Decimal("5.00")


@dataclass(frozen=True)
class OrderPricing:
    service_days: int
    total_visits: int
    base_price: Decimal
    extra_cat_fee: Decimal
    stairs_fee: Decimal
    other_fee: Decimal
    total_amount: Decimal


@dataclass(frozen=True)
class DailyReceivable:
    service_date: date
    expected_amount: Decimal
    paid_amount: Decimal
    due_amount: Decimal
    overpaid_amount: Decimal


def money(value: Decimal | int | float | str) -> Decimal:
    return Decimal(str(value)).quantize(MONEY, rounding=ROUND_HALF_UP)


def calculate_order_pricing(
    *,
    start_date: date,
    end_date: date,
    visits_per_day: int,
    cat_count: int,
    base_price: Decimal,
    stairs_fee: Decimal,
    other_fee: Decimal,
) -> OrderPricing:
    if end_date < start_date:
        raise ValueError("结束日期不能早于开始日期")
    if visits_per_day <= 0:
        raise ValueError("每日次数必须大于 0")
    if cat_count <= 0:
        raise ValueError("订单至少需要一只猫咪")

    service_days = (end_date - start_date).days + 1
    total_visits = service_days * visits_per_day
    normalized_base = money(base_price)
    normalized_stairs = money(stairs_fee)
    normalized_other = money(other_fee)
    extra_cat_fee = money(EXTRA_CAT_UNIT_PRICE * max(cat_count - 1, 0))
    total_amount = money(
        (normalized_base + extra_cat_fee + normalized_stairs) * total_visits
        + normalized_other
    )
    return OrderPricing(
        service_days=service_days,
        total_visits=total_visits,
        base_price=normalized_base,
        extra_cat_fee=extra_cat_fee,
        stairs_fee=normalized_stairs,
        other_fee=normalized_other,
        total_amount=total_amount,
    )


def calculate_per_visit_pricing(
    *, service_days: int, total_visits: int, unit_price: Decimal
) -> OrderPricing:
    if service_days <= 0 or total_visits <= 0:
        raise ValueError("订单至少需要一个服务日期")
    normalized_unit = money(unit_price)
    return OrderPricing(
        service_days=service_days,
        total_visits=total_visits,
        base_price=normalized_unit,
        extra_cat_fee=Decimal("0.00"),
        stairs_fee=Decimal("0.00"),
        other_fee=Decimal("0.00"),
        total_amount=money(normalized_unit * total_visits),
    )


def order_schedule(order: Order) -> list[tuple[date, int]]:
    if order.service_dates:
        return [
            (entry.service_date, entry.visit_count)
            for entry in sorted(order.service_dates, key=lambda item: item.service_date)
        ]
    return [
        (order.start_date + timedelta(days=offset), order.visits_per_day)
        for offset in range((order.end_date - order.start_date).days + 1)
    ]


def order_service_days(order: Order) -> int:
    return len(order_schedule(order))


def order_total_visits(order: Order) -> int:
    return sum(visit_count for _, visit_count in order_schedule(order))


def _adjustment_delta(order: Order, service_date: date) -> Decimal:
    if (
        order.adjustment_service_date != service_date
        or order.adjustment_type is OrderAdjustmentType.NONE
    ):
        return Decimal("0.00")
    if order.adjustment_type is OrderAdjustmentType.SURCHARGE:
        return money(order.adjustment_amount)
    return -money(order.adjustment_amount)


def _base_daily_charge(order: Order, service_date: date) -> Decimal:
    schedule = dict(order_schedule(order))
    if service_date not in schedule:
        raise ValueError("服务日期不属于订单")
    visit_count = schedule[service_date]
    if order.pricing_mode == "per_visit":
        base = money(order.base_price * visit_count)
    else:
        base = money(
            (order.base_price + order.extra_cat_fee + order.stairs_fee) * visit_count
        )
        if service_date == min(schedule):
            base = money(base + order.other_fee)
    return base


def order_daily_charge(order: Order, service_date: date) -> Decimal:
    return money(
        _base_daily_charge(order, service_date)
        + _adjustment_delta(order, service_date)
    )


def order_daily_receivables(order: Order) -> list[DailyReceivable]:
    paid_by_date: dict[date, Decimal] = {}
    for payment in order.payments:
        if (
            payment.payment_status is PaymentRecordStatus.COMPLETED
            and payment.service_date is not None
        ):
            paid_by_date[payment.service_date] = money(
                paid_by_date.get(payment.service_date, Decimal("0.00"))
                + payment.amount
            )
    return [
        DailyReceivable(
            service_date=service_date,
            expected_amount=(expected := order_daily_charge(order, service_date)),
            paid_amount=(paid := paid_by_date.get(service_date, Decimal("0.00"))),
            due_amount=money(max(expected - paid, Decimal("0.00"))),
            overpaid_amount=money(max(paid - expected, Decimal("0.00"))),
        )
        for service_date, _ in order_schedule(order)
    ]


def apply_amount_adjustment(
    order: Order, adjustment: OrderAmountAdjustment
) -> None:
    service_dates = {service_date for service_date, _ in order_schedule(order)}
    if (
        adjustment.service_date is not None
        and adjustment.service_date not in service_dates
    ):
        raise HTTPException(status_code=422, detail="金额变动日期必须属于订单服务日期")
    if (
        adjustment.type is OrderAdjustmentType.DISCOUNT
        and adjustment.service_date is not None
        and money(adjustment.amount) > _base_daily_charge(order, adjustment.service_date)
    ):
        raise HTTPException(status_code=422, detail="减免后当日应收不能小于 0")
    order.adjustment_type = adjustment.type
    order.adjustment_amount = money(adjustment.amount)
    order.adjustment_reason = adjustment.reason
    order.adjustment_service_date = adjustment.service_date


def replace_order_schedule(order: Order, schedule: list[tuple[date, int]]) -> None:
    normalized = sorted(schedule, key=lambda entry: entry[0])
    if not normalized:
        raise ValueError("订单至少需要一个服务日期")
    order.service_dates.clear()
    order.service_dates.extend(
        OrderServiceDate(service_date=service_date, visit_count=visit_count)
        for service_date, visit_count in normalized
    )
    order.start_date = normalized[0][0]
    order.end_date = normalized[-1][0]
    order.visits_per_day = 1


def customer_service_contact(customer: Customer) -> OrderServiceContact:
    return OrderServiceContact(
        name=customer.name,
        wechat_name=customer.wechat_name,
        phone=customer.phone,
        community=customer.community,
        address=customer.address,
        building=customer.building,
        unit=customer.unit,
        room=customer.room,
        access_method=customer.access_method,
        access_info=customer.access_info,
        key_status=customer.key_status,
        key_code=customer.key_code,
        notes=customer.notes,
        is_repeat_customer=customer.is_repeat_customer,
        latitude=customer.latitude,
        longitude=customer.longitude,
        geocode_status=customer.geocode_status,
    )


def cat_snapshot(cats: list[Cat]) -> list[dict[str, object]]:
    return [
        {
            "source_cat_id": cat.id,
            "name": cat.name,
            "photo_url": cat.photo_url,
            "gender": cat.gender,
            "age": str(cat.age) if cat.age is not None else None,
            "breed": cat.breed,
            "personality": cat.personality,
            "food": cat.food,
            "food_preference": cat.food_preference,
            "litter_type": cat.litter_type,
            "medication_required": cat.medication_required,
            "medication_notes": cat.medication_notes,
            "special_notes": cat.special_notes,
            "service_notes": cat.service_notes,
        }
        for cat in cats
    ]


def apply_service_contact(order: Order, contact: OrderServiceContact) -> None:
    order.contact_name = contact.name
    order.contact_wechat_name = contact.wechat_name
    order.contact_phone = contact.phone
    order.contact_community = contact.community
    order.contact_address = contact.address
    order.contact_building = contact.building
    order.contact_unit = contact.unit
    order.contact_room = contact.room
    order.contact_access_method = contact.access_method
    order.contact_access_info = contact.access_info
    order.contact_key_status = contact.key_status
    order.contact_key_code = contact.key_code
    order.contact_notes = contact.notes
    order.contact_is_repeat_customer = contact.is_repeat_customer


def order_service_contact(order: Order) -> OrderServiceContact:
    return OrderServiceContact(
        name=order.contact_name,
        wechat_name=order.contact_wechat_name,
        phone=order.contact_phone,
        community=order.contact_community,
        address=order.contact_address,
        building=order.contact_building,
        unit=order.contact_unit,
        room=order.contact_room,
        access_method=order.contact_access_method,
        access_info=order.contact_access_info,
        key_status=order.contact_key_status,
        key_code=order.contact_key_code,
        notes=order.contact_notes,
        is_repeat_customer=order.contact_is_repeat_customer,
        latitude=order.route_latitude,
        longitude=order.route_longitude,
        geocode_status=order.route_geocode_status,
    )


def _deduplicated_address(parts: list[str | None]) -> str | None:
    values: list[str] = []
    normalized: list[str] = []
    for part in parts:
        value = " ".join((part or "").strip().split())
        if not value:
            continue
        compact = "".join(value.casefold().split())
        if any(compact == existing or compact in existing for existing in normalized):
            continue
        values = [
            existing
            for existing, existing_normalized in zip(values, normalized, strict=True)
            if existing_normalized not in compact
        ]
        normalized = [
            existing
            for existing in normalized
            if existing not in compact
        ]
        values.append(value)
        normalized.append(compact)
    return " ".join(values) or None


_PRIVATE_ROOM_PATTERN = re.compile(
    r"(?:地下)?(?:[A-Za-z]\d{1,5}|\d{1,5}|[一二三四五六七八九十百]+)\s*(?:室|房|户)"
)
_PRIVATE_UNIT_PATTERN = re.compile(
    r"(?:[A-Za-z]|\d{1,3}|[一二三四五六七八九十百]+)\s*(?:单元|门|梯)"
)


def _routable_address_part(value: str | None) -> str | None:
    if not value:
        return None
    without_private_details = _PRIVATE_ROOM_PATTERN.sub(" ", value)
    without_private_details = _PRIVATE_UNIT_PATTERN.sub(" ", without_private_details)
    normalized = " ".join(without_private_details.split())
    return normalized or None


def order_geocode_address(order: Order) -> str | None:
    """Return the routable address without unit or room privacy details."""

    return default_geocode_service_area(
        _deduplicated_address(
            [
                _routable_address_part(order.contact_address),
                order.contact_community,
                order.contact_building,
            ]
        )
    )


DEFAULT_MAP_CITY = "深圳市"
DEFAULT_MAP_DISTRICT = "龙岗区"
_CITY_PATTERN = re.compile(r"(?:^|省|\s)([^省区县乡镇街道路\s]{2,8}市)")
_DISTRICT_PATTERN = re.compile(r"(?:^|省|市|\s)([^省市\s]{1,8}(?:区|县))")


def geocode_address_region(value: str | None) -> tuple[str | None, str | None]:
    if not value:
        return None, None
    city_match = _CITY_PATTERN.search(value)
    district = next(
        (
            match.group(1)
            for match in _DISTRICT_PATTERN.finditer(value)
            if not match.group(1).endswith(("小区", "社区"))
        ),
        None,
    )
    return city_match.group(1) if city_match else None, district


def default_geocode_service_area(value: str | None) -> str | None:
    """Fill the local service area without overwriting an explicit region."""

    if not value:
        return None
    city, district = geocode_address_region(value)
    if city and district:
        return value
    if city:
        return (
            value.replace(DEFAULT_MAP_CITY, f"{DEFAULT_MAP_CITY}{DEFAULT_MAP_DISTRICT}", 1)
            if city == DEFAULT_MAP_CITY
            else value
        )
    if district:
        return (
            value.replace(
                DEFAULT_MAP_DISTRICT,
                f"{DEFAULT_MAP_CITY}{DEFAULT_MAP_DISTRICT}",
                1,
            )
            if district == DEFAULT_MAP_DISTRICT
            else value
        )
    return f"{DEFAULT_MAP_CITY}{DEFAULT_MAP_DISTRICT}{value}"


def order_display_address(order: Order) -> str | None:
    return _deduplicated_address(
        [
            order.contact_community,
            order.contact_address,
            order.contact_building,
            order.contact_unit,
            order.contact_room,
        ]
    )


def _resolved_contact(
    payload: OrderCreate,
    source_customer: Customer | None,
) -> OrderServiceContact:
    if payload.service_contact is not None:
        return payload.service_contact
    if payload.customer_name is not None:
        return OrderServiceContact(name=payload.customer_name)
    if source_customer is not None:
        return customer_service_contact(source_customer)
    raise ValueError("订单缺少联系人信息")


def build_order(
    payload: OrderWrite,
    *,
    cats: list[Cat],
    customer: Customer,
) -> Order:
    """Build an order and its tasks without committing the caller's transaction."""

    pricing = calculate_order_pricing(
        start_date=payload.start_date,
        end_date=payload.end_date,
        visits_per_day=payload.visits_per_day,
        cat_count=len(cats),
        base_price=payload.base_price,
        stairs_fee=payload.stairs_fee,
        other_fee=payload.other_fee,
    )
    order = Order(
        customer_id=payload.customer_id,
        contact_name=customer.name,
        start_date=payload.start_date,
        end_date=payload.end_date,
        visits_per_day=payload.visits_per_day,
        cat_count=len(cats),
        service_items=[item.value for item in payload.service_items],
        pricing_mode="legacy_components",
        settlement_mode=payload.settlement_mode,
        base_price=pricing.base_price,
        extra_cat_fee=pricing.extra_cat_fee,
        stairs_fee=pricing.stairs_fee,
        other_fee=pricing.other_fee,
        total_amount=pricing.total_amount,
        paid_amount=0,
        payment_status=OrderPaymentStatus.UNPAID,
        order_status=payload.order_status,
        notes=payload.notes,
        cat_snapshot=cat_snapshot(cats),
    )
    apply_service_contact(order, customer_service_contact(customer))
    order.cat_links.extend(OrderCat(cat=cat) for cat in cats)
    replace_order_schedule(
        order,
        [
            (payload.start_date + timedelta(days=offset), payload.visits_per_day)
            for offset in range((payload.end_date - payload.start_date).days + 1)
        ],
    )
    order.visits_per_day = payload.visits_per_day
    apply_amount_adjustment(order, payload.amount_adjustment)
    reprice_order(order)
    generate_order_tasks(order)
    return order


def build_simple_order(
    payload: OrderCreate,
    *,
    source_customer: Customer | None = None,
) -> Order:
    schedule = [(service_date, 1) for service_date in payload.service_dates]
    pricing = calculate_per_visit_pricing(
        service_days=len(schedule),
        total_visits=len(schedule),
        unit_price=payload.unit_price,
    )
    order = Order(
        customer_id=source_customer.id if source_customer is not None else None,
        contact_name="",
        start_date=payload.service_dates[0],
        end_date=payload.service_dates[-1],
        visits_per_day=1,
        cat_count=payload.cat_count,
        service_items=[item.value for item in payload.service_items],
        pricing_mode="per_visit",
        settlement_mode=payload.settlement_mode,
        base_price=pricing.base_price,
        extra_cat_fee=pricing.extra_cat_fee,
        stairs_fee=pricing.stairs_fee,
        other_fee=pricing.other_fee,
        total_amount=pricing.total_amount,
        paid_amount=0,
        payment_status=OrderPaymentStatus.UNPAID,
        order_status=OrderStatus.CONFIRMED,
        notes=payload.notes,
        cat_snapshot=(
            [item.model_dump(mode="json") for item in payload.cat_snapshot]
            if payload.cat_snapshot
            else cat_snapshot(
                [cat for cat in source_customer.cats if cat.is_active][
                    : payload.cat_count
                ]
                if source_customer is not None
                else []
            )
        ),
    )
    apply_service_contact(order, _resolved_contact(payload, source_customer))
    replace_order_schedule(order, schedule)
    apply_amount_adjustment(order, payload.amount_adjustment)
    reprice_order(order)
    generate_order_tasks(order)
    return order


def due_amount(order: Order) -> Decimal:
    if order.settlement_mode is OrderSettlementMode.DAILY:
        return money(
            sum(
                (item.due_amount for item in order_daily_receivables(order)),
                Decimal("0.00"),
            )
        )
    return money(max(order.total_amount - order.paid_amount, Decimal("0")))


def overpaid_amount(order: Order) -> Decimal:
    if order.settlement_mode is OrderSettlementMode.DAILY:
        return money(
            sum(
                (item.overpaid_amount for item in order_daily_receivables(order)),
                Decimal("0.00"),
            )
        )
    return money(max(order.paid_amount - order.total_amount, Decimal("0")))


def payment_status_for_amounts(
    *,
    total_amount: Decimal,
    paid_amount: Decimal,
    current_status: OrderPaymentStatus | None = None,
) -> OrderPaymentStatus:
    if current_status is OrderPaymentStatus.REFUNDED:
        return OrderPaymentStatus.REFUNDED
    if paid_amount <= 0:
        return OrderPaymentStatus.UNPAID
    if paid_amount < total_amount:
        return OrderPaymentStatus.PARTIAL
    return OrderPaymentStatus.PAID


def payment_status_for_order(order: Order) -> OrderPaymentStatus:
    if order.payment_status is OrderPaymentStatus.REFUNDED:
        return OrderPaymentStatus.REFUNDED
    if money(order.paid_amount) <= 0:
        return OrderPaymentStatus.UNPAID
    if due_amount(order) > 0:
        return OrderPaymentStatus.PARTIAL
    return OrderPaymentStatus.PAID


def reprice_order(order: Order, *, unit_price: Decimal | None = None) -> None:
    if unit_price is not None:
        order.pricing_mode = "per_visit"
        order.base_price = money(unit_price)
        order.extra_cat_fee = Decimal("0.00")
        order.stairs_fee = Decimal("0.00")
        order.other_fee = Decimal("0.00")

    if order.pricing_mode != "per_visit":
        order.extra_cat_fee = money(EXTRA_CAT_UNIT_PRICE * max(order.cat_count - 1, 0))
    service_dates = {service_date for service_date, _ in order_schedule(order)}
    if (
        order.adjustment_type is not OrderAdjustmentType.NONE
        and order.adjustment_service_date not in service_dates
    ):
        raise HTTPException(status_code=422, detail="金额变动日期必须属于订单服务日期")
    if (
        order.adjustment_type is OrderAdjustmentType.DISCOUNT
        and order.adjustment_service_date is not None
        and money(order.adjustment_amount)
        > _base_daily_charge(order, order.adjustment_service_date)
    ):
        raise HTTPException(status_code=422, detail="减免后当日应收不能小于 0")
    order.total_amount = money(
        sum(
            (order_daily_charge(order, service_date) for service_date, _ in order_schedule(order)),
            Decimal("0.00"),
        )
    )
    order.payment_status = payment_status_for_order(order)


def initial_task_status(order_status: OrderStatus) -> TaskStatus:
    if order_status is OrderStatus.PENDING_CONFIRMATION:
        return TaskStatus.PENDING
    if order_status is OrderStatus.CANCELLED:
        return TaskStatus.CANCELLED
    if order_status is OrderStatus.COMPLETED:
        return TaskStatus.COMPLETED
    return TaskStatus.CONFIRMED


def generate_order_tasks(order: Order) -> None:
    task_status = initial_task_status(order.order_status)
    service_items = [TaskItemType(item) for item in order.service_items]
    for service_date, visit_count in order_schedule(order):
        for visit_index in range(visit_count):
            task = Task(
                customer_id=order.customer_id,
                service_date=service_date,
                sort_order=visit_index,
                status=task_status,
            )
            task.items.extend(
                TaskItem(item_type=item_type, required=True, completed=False)
                for item_type in service_items
            )
            order.tasks.append(task)


PROTECTED_TASK_STATUSES = {
    TaskStatus.IN_PROGRESS,
    TaskStatus.COMPLETED,
    TaskStatus.EXCEPTION,
}
MUTABLE_TASK_STATUSES = {
    TaskStatus.PENDING,
    TaskStatus.CONFIRMED,
    TaskStatus.READY,
    TaskStatus.CANCELLED,
}


def task_has_execution_history(task: Task) -> bool:
    return (
        task.status in PROTECTED_TASK_STATUSES
        or task.started_at is not None
        or task.completed_at is not None
        or bool(task.photos)
        or any(item.completed for item in task.items)
    )


def order_has_execution_history(order: Order) -> bool:
    return any(task_has_execution_history(task) for task in order.tasks)


def require_tasks_are_rebuildable(order: Order) -> None:
    if order_has_execution_history(order):
        raise HTTPException(
            status_code=409,
            detail="订单已有执行记录，不能重建日期、次数、客户、猫咪或服务事项",
        )


def synchronize_task_statuses(order: Order, new_status: OrderStatus) -> None:
    if new_status is OrderStatus.COMPLETED:
        if any(task.status is not TaskStatus.COMPLETED for task in order.tasks):
            raise HTTPException(
                status_code=409,
                detail="仍有未完成任务，不能将订单标记为已完成",
            )
        return

    target_status = initial_task_status(new_status)
    for task in order.tasks:
        if task.status in MUTABLE_TASK_STATUSES:
            task.status = target_status
