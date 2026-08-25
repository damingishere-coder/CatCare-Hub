from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.models.enums import (
    OrderPaymentStatus,
    OrderStatus,
    PaymentRecordStatus,
    TaskItemType,
    TaskStatus,
)
from app.models.order import Order, OrderCat
from app.models.payment import Payment
from app.models.task import Task
from app.schemas.dashboard import (
    DashboardMetrics,
    DashboardPhotoSent,
    DashboardReminder,
    DashboardResponse,
    DashboardTaskSummary,
)
from app.services.business_time import (
    as_utc,
    business_month_bounds_utc,
    current_business_date,
)
from app.services.orders import due_amount, money, order_display_address
from app.services.task_execution import (
    execution_revision,
    load_execution_task,
    require_execution_revision,
)


OPEN_TASK_STATUSES = {
    TaskStatus.PENDING,
    TaskStatus.CONFIRMED,
    TaskStatus.READY,
    TaskStatus.IN_PROGRESS,
}
PHOTO_DELIVERY_STATUSES = {TaskStatus.COMPLETED, TaskStatus.EXCEPTION}


def _load_day_tasks(session: Session, business_date: date) -> list[Task]:
    return list(
        session.scalars(
            select(Task)
            .join(Task.order)
            .where(
                Task.service_date == business_date,
                Task.status != TaskStatus.CANCELLED,
                Order.order_status != OrderStatus.CANCELLED,
            )
            .options(
                selectinload(Task.items),
                selectinload(Task.photos),
                selectinload(Task.order)
                .selectinload(Order.cat_links)
                .selectinload(OrderCat.cat),
            )
            .order_by(Task.sort_order, Task.id)
        ).unique()
    )


def _load_relevant_orders(session: Session, business_date: date) -> list[Order]:
    tomorrow = business_date + timedelta(days=1)
    return list(
        session.scalars(
            select(Order)
            .where(
                Order.order_status != OrderStatus.CANCELLED,
                or_(
                    Order.payment_status != OrderPaymentStatus.REFUNDED,
                    Order.end_date == business_date,
                    Order.start_date == tomorrow,
                ),
            )
            .options(
                selectinload(Order.customer),
                selectinload(Order.cat_links),
                selectinload(Order.payments),
                selectinload(Order.service_dates),
            )
            .order_by(Order.id)
        ).unique()
    )


def _load_pending_photo_tasks(session: Session, business_date: date) -> list[Task]:
    return list(
        session.scalars(
            select(Task)
            .join(Task.order)
            .where(
                Task.service_date <= business_date,
                Task.status.in_(PHOTO_DELIVERY_STATUSES),
                Task.photos_sent_at.is_(None),
                Task.photos.any(),
                Order.order_status != OrderStatus.CANCELLED,
            )
            .options(
                selectinload(Task.items),
                selectinload(Task.photos),
                selectinload(Task.order)
                .selectinload(Order.cat_links)
                .selectinload(OrderCat.cat),
            )
            .order_by(Task.service_date, Task.sort_order, Task.id)
        ).unique()
    )


def _month_income(session: Session, business_date: date) -> Decimal:
    start_utc, end_utc = business_month_bounds_utc(business_date)
    total = session.scalar(
        select(func.sum(Payment.amount)).where(
            Payment.payment_status == PaymentRecordStatus.COMPLETED,
            Payment.paid_at.is_not(None),
            Payment.paid_at >= start_utc,
            Payment.paid_at < end_utc,
        )
    )
    return money(total or Decimal("0"))


def _month_order_count(session: Session, business_date: date) -> int:
    month_start = business_date.replace(day=1)
    next_month = (
        month_start.replace(year=month_start.year + 1, month=1)
        if month_start.month == 12
        else month_start.replace(month=month_start.month + 1)
    )
    count = session.scalar(
        select(func.count(func.distinct(Task.order_id)))
        .join(Task.order)
        .where(
            Task.service_date >= month_start,
            Task.service_date < next_month,
            Task.status != TaskStatus.CANCELLED,
            Order.order_status != OrderStatus.CANCELLED,
        )
    )
    return count or 0


def _task_summary(task: Task) -> DashboardTaskSummary:
    return DashboardTaskSummary(
        id=task.id,
        order_id=task.order_id,
        planned_time=task.planned_time,
        sort_order=task.sort_order,
        status=task.status,
        customer_name=task.order.contact_name,
        community=task.order.contact_community,
        address=order_display_address(task.order),
        cat_count=task.order.cat_count,
    )


def _task_label(task: Task) -> str:
    planned = task.planned_time.strftime("%H:%M") if task.planned_time else "未定时间"
    return f"{planned} · {task.order.contact_name}"


def _task_reminders(
    tasks: list[Task],
    pending_photo_tasks: list[Task],
) -> list[DashboardReminder]:
    reminders: list[DashboardReminder] = []
    seen_key_orders: set[int] = set()

    for task in tasks:
        if task.status not in OPEN_TASK_STATUSES:
            continue
        if (
            task.order.contact_key_status == "待取"
            and task.order_id not in seen_key_orders
        ):
            seen_key_orders.add(task.order_id)
            reminders.append(
                DashboardReminder(
                    id=f"key_pickup:order:{task.order_id}",
                    kind="key_pickup",
                    customer_name=task.order.contact_name,
                    task_id=task.id,
                    order_id=task.order_id,
                    cat_count=task.order.cat_count,
                    message=f"{_task_label(task)}，钥匙状态为待取",
                )
            )

        medicine_items = [
            item for item in task.items if item.item_type is TaskItemType.MEDICINE
        ]
        medicine_pending = any(not item.completed for item in medicine_items)
        if not medicine_items:
            medicine_pending = any(
                bool(cat.get("medication_required"))
                for cat in task.order.cat_snapshot
            )
        if medicine_pending:
            reminders.append(
                DashboardReminder(
                    id=f"medicine:task:{task.id}",
                    kind="medicine",
                    customer_name=task.order.contact_name,
                    task_id=task.id,
                    order_id=task.order_id,
                    cat_count=task.order.cat_count,
                    message=f"{_task_label(task)}，请核对喂药要求",
                )
            )

    for task in pending_photo_tasks:
        reminders.append(
            DashboardReminder(
                id=f"photos_pending:task:{task.id}",
                kind="photos_pending",
                customer_name=task.order.contact_name,
                task_id=task.id,
                order_id=task.order_id,
                cat_count=task.order.cat_count,
                expected_revision=execution_revision(task),
                message=(
                    f"{task.service_date.strftime('%m-%d')} · {_task_label(task)}，"
                    "现场照片尚未标记发送"
                ),
            )
        )
    return reminders


def _order_reminders(
    orders: list[Order],
    tasks: list[Task],
    business_date: date,
) -> tuple[list[DashboardReminder], list[Order]]:
    reminders: list[DashboardReminder] = []
    tomorrow = business_date + timedelta(days=1)
    tasks_by_order: dict[int, list[Task]] = {}
    for task in tasks:
        tasks_by_order.setdefault(task.order_id, []).append(task)

    pending_orders: list[Order] = []
    for order in orders:
        amount_due = due_amount(order)
        if (
            order.payment_status is not OrderPaymentStatus.REFUNDED
            and amount_due > 0
        ):
            pending_orders.append(order)
            reminders.append(
                DashboardReminder(
                    id=f"payment_due:order:{order.id}",
                    kind="payment_due",
                    customer_name=order.contact_name,
                    order_id=order.id,
                    cat_count=order.cat_count,
                    amount=amount_due,
                    message=f"订单 #{order.id} 待收 {amount_due:.2f} 元",
                )
            )

        if order.end_date == business_date and tasks_by_order.get(order.id):
            final_task = tasks_by_order[order.id][-1]
            reminders.append(
                DashboardReminder(
                    id=f"last_service:order:{order.id}",
                    kind="last_service",
                    customer_name=order.contact_name,
                    task_id=final_task.id,
                    order_id=order.id,
                    cat_count=order.cat_count,
                    message=f"订单 #{order.id} 今天完成最后一次服务",
                )
            )

        if order.start_date == tomorrow:
            reminders.append(
                DashboardReminder(
                    id=f"order_starts_tomorrow:order:{order.id}",
                    kind="order_starts_tomorrow",
                    customer_name=order.contact_name,
                    order_id=order.id,
                    cat_count=order.cat_count,
                    message=f"订单 #{order.id} 将于明日开始",
                )
            )
    return reminders, pending_orders


def get_dashboard(
    session: Session,
    business_date: date | None = None,
) -> DashboardResponse:
    target_date = business_date or current_business_date()
    tasks = _load_day_tasks(session, target_date)
    pending_photo_tasks = _load_pending_photo_tasks(session, target_date)
    orders = _load_relevant_orders(session, target_date)
    order_reminders, pending_orders = _order_reminders(orders, tasks, target_date)
    schedule = [_task_summary(task) for task in tasks]
    reminders = [*_task_reminders(tasks, pending_photo_tasks), *order_reminders]
    return DashboardResponse(
        business_date=target_date,
        month_start=target_date.replace(day=1),
        metrics=DashboardMetrics(
            month_order_count=_month_order_count(session, target_date),
            pending_task_count=sum(
                task.status in OPEN_TASK_STATUSES for task in tasks
            ),
            pending_payment_count=len(pending_orders),
            month_income=_month_income(session, target_date),
        ),
        schedule=schedule,
        reminders=reminders,
    )


def mark_task_photos_sent(
    session: Session,
    task_id: int,
    expected_revision: str,
) -> DashboardPhotoSent:
    task = load_execution_task(session, task_id)
    require_execution_revision(task, expected_revision)
    if task.status not in PHOTO_DELIVERY_STATUSES:
        raise HTTPException(status_code=409, detail="只有已完成或异常任务可以标记照片已发送")
    if not task.photos:
        raise HTTPException(status_code=409, detail="任务没有可发送的现场照片")
    if task.photos_sent_at is not None:
        raise HTTPException(status_code=409, detail="任务照片已经标记发送")

    task.photos_sent_at = datetime.now(timezone.utc)
    session.commit()
    session.expire_all()
    task = load_execution_task(session, task_id)
    sent_at = as_utc(task.photos_sent_at)
    if sent_at is None:
        raise RuntimeError("照片发送时间写入失败")
    return DashboardPhotoSent(
        task_id=task.id,
        photos_sent_at=sent_at,
        revision=execution_revision(task),
    )
