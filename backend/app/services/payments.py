import hashlib
import json
from datetime import date, datetime
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, selectinload

from app.models.enums import (
    OrderPaymentStatus,
    OrderSettlementMode,
    OrderStatus,
    PaymentRecordStatus,
)
from app.models.order import Order, OrderCat
from app.models.payment import Payment
from app.schemas.payment import (
    PaymentCreate,
    PaymentMetrics,
    PaymentReceivable,
    PaymentRecordRead,
    PaymentRegistration,
    PaymentsOverview,
)
from app.services.business_time import (
    as_utc,
    business_day_bounds_utc,
    business_month_bounds_utc,
    current_business_date,
)
from app.services.orders import (
    due_amount,
    money,
    order_daily_receivables,
    order_display_address,
    overpaid_amount,
    payment_status_for_amounts,
)


def _datetime_value(value: datetime | None) -> str | None:
    normalized = as_utc(value)
    return normalized.isoformat() if normalized else None


def _order_load_options() -> tuple:
    return (
        selectinload(Order.customer),
        selectinload(Order.cat_links).selectinload(OrderCat.cat),
        selectinload(Order.payments),
        selectinload(Order.service_dates),
        selectinload(Order.tasks),
    )


def _load_payment_order(session: Session, order_id: int) -> Order:
    order = session.scalar(
        select(Order).where(Order.id == order_id).options(*_order_load_options())
    )
    if order is None:
        raise HTTPException(status_code=404, detail="订单不存在")
    return order


def payment_revision(order: Order) -> str:
    payload = {
        "order": {
            "id": order.id,
            "total_amount": f"{money(order.total_amount):.2f}",
            "paid_amount": f"{money(order.paid_amount):.2f}",
            "payment_status": order.payment_status.value,
            "settlement_mode": order.settlement_mode.value,
            "adjustment_type": order.adjustment_type.value,
            "adjustment_amount": f"{money(order.adjustment_amount):.2f}",
            "adjustment_service_date": (
                order.adjustment_service_date.isoformat()
                if order.adjustment_service_date
                else None
            ),
            "order_status": order.order_status.value,
            "updated_at": _datetime_value(order.updated_at),
        },
        "payments": [
            {
                "id": payment.id,
                "amount": f"{money(payment.amount):.2f}",
                "status": payment.payment_status.value,
                "service_date": (
                    payment.service_date.isoformat() if payment.service_date else None
                ),
                "paid_at": _datetime_value(payment.paid_at),
            }
            for payment in sorted(order.payments, key=lambda entry: entry.id)
        ],
    }
    serialized = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _require_payment_revision(order: Order, expected_revision: str) -> None:
    if payment_revision(order) != expected_revision:
        raise HTTPException(
            status_code=409,
            detail="订单收款信息已变化，请刷新后重新登记",
        )


def _task_status_for_date(order: Order, service_date: date | None):
    if service_date is None:
        return None
    tasks = sorted(
        (task for task in order.tasks if task.service_date == service_date),
        key=lambda task: (task.sort_order, task.id),
    )
    return tasks[0].status if tasks else None


def _receivable(
    order: Order,
    *,
    service_date: date | None = None,
    total_amount: Decimal | None = None,
    paid_amount: Decimal | None = None,
    item_due_amount: Decimal | None = None,
) -> PaymentReceivable:
    return PaymentReceivable(
        order_id=order.id,
        settlement_mode=order.settlement_mode,
        service_date=service_date,
        customer_name=order.contact_name,
        community=order.contact_community,
        address=order_display_address(order),
        start_date=order.start_date,
        end_date=order.end_date,
        cat_count=order.cat_count,
        total_amount=money(total_amount if total_amount is not None else order.total_amount),
        paid_amount=money(paid_amount if paid_amount is not None else order.paid_amount),
        due_amount=(
            money(item_due_amount) if item_due_amount is not None else due_amount(order)
        ),
        overpaid_amount=overpaid_amount(order),
        payment_status=order.payment_status,
        order_status=order.order_status,
        task_status=_task_status_for_date(order, service_date),
        revision=payment_revision(order),
    )


def _receivables(order: Order) -> list[PaymentReceivable]:
    if order.settlement_mode is OrderSettlementMode.ORDER_TOTAL:
        return [_receivable(order)] if due_amount(order) > 0 else []
    return [
        _receivable(
            order,
            service_date=item.service_date,
            total_amount=item.expected_amount,
            paid_amount=item.paid_amount,
            item_due_amount=item.due_amount,
        )
        for item in order_daily_receivables(order)
        if item.due_amount > 0
    ]


def _payment_record(payment: Payment) -> PaymentRecordRead:
    order = payment.order
    return PaymentRecordRead(
        id=payment.id,
        order_id=payment.order_id,
        service_date=payment.service_date,
        customer_name=order.contact_name,
        start_date=order.start_date,
        end_date=order.end_date,
        cat_count=order.cat_count,
        amount=money(payment.amount),
        payment_method=payment.payment_method,
        payment_status=payment.payment_status,
        paid_at=as_utc(payment.paid_at),
    )


def _load_receivable_orders(session: Session) -> list[Order]:
    return list(
        session.scalars(
            select(Order)
            .where(
                Order.order_status != OrderStatus.CANCELLED,
                Order.payment_status != OrderPaymentStatus.REFUNDED,
                Order.total_amount > Order.paid_amount,
            )
            .options(*_order_load_options())
            .order_by(Order.start_date, Order.id)
        ).unique()
    )


def _load_payment_records(session: Session) -> list[Payment]:
    return list(
        session.scalars(
            select(Payment)
            .options(
                selectinload(Payment.order).selectinload(Order.customer),
                selectinload(Payment.order).selectinload(Order.cat_links),
            )
            .order_by(Payment.paid_at.desc().nulls_last(), Payment.id.desc())
        ).unique()
    )


def _completed_income(
    session: Session,
    start_utc: datetime,
    end_utc: datetime,
) -> Decimal:
    total = session.scalar(
        select(func.sum(Payment.amount)).where(
            Payment.payment_status == PaymentRecordStatus.COMPLETED,
            Payment.paid_at.is_not(None),
            Payment.paid_at >= start_utc,
            Payment.paid_at < end_utc,
        )
    )
    return money(total or Decimal("0"))


def get_payments_overview(
    session: Session,
    business_date: date | None = None,
) -> PaymentsOverview:
    target_date = business_date or current_business_date()
    day_start, day_end = business_day_bounds_utc(target_date)
    month_start, month_end = business_month_bounds_utc(target_date)
    receivable_orders = _load_receivable_orders(session)
    completed_order_count = session.scalar(
        select(func.count(Order.id)).where(Order.order_status == OrderStatus.COMPLETED)
    )
    receivables = [item for order in receivable_orders for item in _receivables(order)]
    return PaymentsOverview(
        business_date=target_date,
        month_start=target_date.replace(day=1),
        metrics=PaymentMetrics(
            today_income=_completed_income(session, day_start, day_end),
            pending_order_count=len(receivables),
            month_income=_completed_income(session, month_start, month_end),
            completed_order_count=completed_order_count or 0,
        ),
        receivables=receivables,
        records=[_payment_record(payment) for payment in _load_payment_records(session)],
    )


def register_payment(
    session: Session,
    payload: PaymentCreate,
) -> PaymentRegistration:
    order = _load_payment_order(session, payload.order_id)
    _require_payment_revision(order, payload.expected_revision)
    if order.order_status is OrderStatus.CANCELLED:
        raise HTTPException(status_code=409, detail="已取消订单不能登记收款")
    if order.payment_status is OrderPaymentStatus.REFUNDED:
        raise HTTPException(status_code=409, detail="已退款订单不能登记新收款")

    if order.settlement_mode is OrderSettlementMode.DAILY:
        if payload.service_date is None:
            raise HTTPException(status_code=422, detail="日结订单必须选择服务日期")
        daily = next(
            (
                item
                for item in order_daily_receivables(order)
                if item.service_date == payload.service_date
            ),
            None,
        )
        if daily is None:
            raise HTTPException(status_code=422, detail="收款日期不属于订单服务日期")
        current_due = daily.due_amount
    else:
        if payload.service_date is not None:
            raise HTTPException(status_code=422, detail="整单结算不能指定服务日期")
        current_due = due_amount(order)
    if current_due <= 0:
        raise HTTPException(status_code=409, detail="订单已经没有待收金额")
    amount = money(payload.amount)
    if amount > current_due:
        raise HTTPException(
            status_code=409,
            detail=f"收款金额不能超过当前待收 {current_due:.2f} 元",
        )

    previous_paid = money(order.paid_amount)
    next_paid = money(previous_paid + amount)
    next_status = payment_status_for_amounts(
        total_amount=order.total_amount,
        paid_amount=next_paid,
    )
    result = session.execute(
        update(Order)
        .where(
            Order.id == order.id,
            Order.total_amount == order.total_amount,
            Order.paid_amount == order.paid_amount,
            Order.payment_status == order.payment_status,
            Order.order_status == order.order_status,
            Order.settlement_mode == order.settlement_mode,
            Order.adjustment_type == order.adjustment_type,
            Order.adjustment_amount == order.adjustment_amount,
            Order.adjustment_service_date == order.adjustment_service_date,
        )
        .values(paid_amount=next_paid, payment_status=next_status)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        session.rollback()
        raise HTTPException(
            status_code=409,
            detail="订单收款信息已变化，请刷新后重新登记",
        )

    payment = Payment(
        order_id=order.id,
        customer_id=order.customer_id,
        service_date=payload.service_date,
        amount=amount,
        payment_method=payload.payment_method,
        payment_status=PaymentRecordStatus.COMPLETED,
        paid_at=as_utc(payload.paid_at),
        notes=payload.notes,
    )
    session.add(payment)
    session.commit()
    payment_id = payment.id
    session.expire_all()
    refreshed_order = _load_payment_order(session, order.id)
    refreshed_payment = next(
        entry for entry in refreshed_order.payments if entry.id == payment_id
    )
    if refreshed_order.settlement_mode is OrderSettlementMode.DAILY:
        refreshed_daily = next(
            item
            for item in order_daily_receivables(refreshed_order)
            if item.service_date == payload.service_date
        )
        matching_receivable = _receivable(
            refreshed_order,
            service_date=refreshed_daily.service_date,
            total_amount=refreshed_daily.expected_amount,
            paid_amount=refreshed_daily.paid_amount,
            item_due_amount=refreshed_daily.due_amount,
        )
    else:
        matching_receivable = _receivable(refreshed_order)
    return PaymentRegistration(
        payment=_payment_record(refreshed_payment),
        order=matching_receivable,
    )
