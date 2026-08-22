from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException

from app.models.customer import Cat
from app.models.enums import OrderPaymentStatus, OrderStatus, TaskItemType, TaskStatus
from app.models.order import Order, OrderCat
from app.models.task import Task, TaskItem
from app.schemas.order import OrderWrite


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


def money(value: Decimal) -> Decimal:
    return value.quantize(MONEY, rounding=ROUND_HALF_UP)


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


def build_order(payload: OrderWrite, *, cats: list[Cat]) -> Order:
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
        start_date=payload.start_date,
        end_date=payload.end_date,
        visits_per_day=payload.visits_per_day,
        service_items=[item.value for item in payload.service_items],
        base_price=pricing.base_price,
        extra_cat_fee=pricing.extra_cat_fee,
        stairs_fee=pricing.stairs_fee,
        other_fee=pricing.other_fee,
        total_amount=pricing.total_amount,
        paid_amount=0,
        payment_status=OrderPaymentStatus.UNPAID,
        order_status=payload.order_status,
        notes=payload.notes,
    )
    order.cat_links.extend(OrderCat(cat=cat) for cat in cats)
    generate_order_tasks(order)
    return order


def due_amount(order: Order) -> Decimal:
    return money(max(order.total_amount - order.paid_amount, Decimal("0")))


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
    service_days = (order.end_date - order.start_date).days + 1

    for day_offset in range(service_days):
        service_date = order.start_date + timedelta(days=day_offset)
        for visit_index in range(order.visits_per_day):
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
