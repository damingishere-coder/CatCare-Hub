from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.session import get_db
from app.models.customer import Cat, Customer
from app.models.enums import OrderPaymentStatus, OrderStatus, TaskItemType
from app.models.order import Order, OrderCat
from app.models.task import Task
from app.schemas.order import (
    OrderCatOption,
    OrderCatSummary,
    OrderCustomerOption,
    OrderCustomerSummary,
    OrderDetail,
    OrderFormOptions,
    OrderListResponse,
    OrderStatusUpdate,
    OrderSummary,
    OrderTaskItemRead,
    OrderTaskRead,
    OrderWrite,
)
from app.services.orders import (
    DEFAULT_BASE_PRICE,
    EXTRA_CAT_UNIT_PRICE,
    STAIRS_UNIT_PRICE,
    build_order,
    calculate_order_pricing,
    due_amount,
    generate_order_tasks,
    payment_status_for_amounts,
    require_tasks_are_rebuildable,
    synchronize_task_statuses,
)


router = APIRouter(prefix="/api/admin/orders", tags=["admin-orders"])
DatabaseSession = Annotated[Session, Depends(get_db)]


def _order_load_options() -> tuple:
    return (
        selectinload(Order.customer),
        selectinload(Order.cat_links).selectinload(OrderCat.cat),
        selectinload(Order.tasks).selectinload(Task.items),
        selectinload(Order.tasks).selectinload(Task.photos),
        selectinload(Order.payments),
    )


def _load_order(session: Session, order_id: int) -> Order:
    order = session.scalar(
        select(Order).options(*_order_load_options()).where(Order.id == order_id)
    )
    if order is None:
        raise HTTPException(status_code=404, detail="订单不存在")
    return order


def _cat_summaries(order: Order) -> list[OrderCatSummary]:
    return [
        OrderCatSummary(id=link.cat.id, name=link.cat.name, is_active=link.cat.is_active)
        for link in sorted(order.cat_links, key=lambda item: item.cat_id)
    ]


def _order_summary(order: Order) -> OrderSummary:
    service_days = (order.end_date - order.start_date).days + 1
    return OrderSummary(
        id=order.id,
        customer=OrderCustomerSummary(
            id=order.customer.id,
            name=order.customer.name,
            community=order.customer.community,
        ),
        cats=_cat_summaries(order),
        start_date=order.start_date,
        end_date=order.end_date,
        visits_per_day=order.visits_per_day,
        service_days=service_days,
        total_visits=service_days * order.visits_per_day,
        service_items=[TaskItemType(item) for item in order.service_items],
        base_price=order.base_price,
        extra_cat_fee=order.extra_cat_fee,
        stairs_fee=order.stairs_fee,
        other_fee=order.other_fee,
        total_amount=order.total_amount,
        paid_amount=order.paid_amount,
        due_amount=due_amount(order),
        payment_status=order.payment_status,
        order_status=order.order_status,
        task_count=len(order.tasks),
        updated_at=order.updated_at,
    )


def _order_detail(order: Order) -> OrderDetail:
    summary = _order_summary(order)
    tasks = [
        OrderTaskRead(
            id=task.id,
            service_date=task.service_date,
            planned_time=task.planned_time,
            sort_order=task.sort_order,
            status=task.status,
            items=[
                OrderTaskItemRead(
                    item_type=item.item_type,
                    required=item.required,
                    completed=item.completed,
                )
                for item in sorted(task.items, key=lambda entry: entry.id)
            ],
        )
        for task in sorted(
            order.tasks,
            key=lambda entry: (entry.service_date, entry.sort_order, entry.id),
        )
    ]
    return OrderDetail(
        **summary.model_dump(),
        notes=order.notes,
        tasks=tasks,
        created_at=order.created_at,
    )


def _validate_customer_and_cats(
    session: Session,
    *,
    customer_id: int,
    cat_ids: list[int],
    allowed_inactive_ids: set[int] | None = None,
) -> tuple[Customer, list[Cat]]:
    customer = session.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(status_code=404, detail="客户不存在")

    cats = session.scalars(select(Cat).where(Cat.id.in_(cat_ids))).all()
    cats_by_id = {cat.id: cat for cat in cats}
    if len(cats_by_id) != len(cat_ids):
        raise HTTPException(status_code=422, detail="所选猫咪不存在或不可用于该订单")

    allowed_inactive = allowed_inactive_ids or set()
    ordered_cats = [cats_by_id[cat_id] for cat_id in cat_ids]
    if any(cat.customer_id != customer_id for cat in ordered_cats):
        raise HTTPException(status_code=422, detail="所选猫咪不属于该客户")
    if any(not cat.is_active and cat.id not in allowed_inactive for cat in ordered_cats):
        raise HTTPException(status_code=422, detail="不能把已停用猫咪加入新订单")
    return customer, ordered_cats


def _pricing(payload: OrderWrite):
    return calculate_order_pricing(
        start_date=payload.start_date,
        end_date=payload.end_date,
        visits_per_day=payload.visits_per_day,
        cat_count=len(payload.cat_ids),
        base_price=payload.base_price,
        stairs_fee=payload.stairs_fee,
        other_fee=payload.other_fee,
    )


@router.get("/form-options", response_model=OrderFormOptions)
def get_order_form_options(session: DatabaseSession) -> OrderFormOptions:
    customers = session.scalars(
        select(Customer).options(selectinload(Customer.cats)).order_by(Customer.name, Customer.id)
    ).all()
    return OrderFormOptions(
        customers=[
            OrderCustomerOption(
                id=customer.id,
                name=customer.name,
                community=customer.community,
                cats=[
                    OrderCatOption(id=cat.id, name=cat.name)
                    for cat in sorted(customer.cats, key=lambda item: (item.name, item.id))
                    if cat.is_active
                ],
            )
            for customer in customers
        ],
        default_base_price=DEFAULT_BASE_PRICE,
        extra_cat_unit_price=EXTRA_CAT_UNIT_PRICE,
        stairs_unit_price=STAIRS_UNIT_PRICE,
    )


@router.get("", response_model=OrderListResponse)
def list_orders(session: DatabaseSession) -> OrderListResponse:
    orders = session.scalars(
        select(Order)
        .options(*_order_load_options())
        .order_by(Order.start_date.desc(), Order.id.desc())
    ).all()
    return OrderListResponse(
        items=[_order_summary(order) for order in orders],
        total=len(orders),
    )


@router.post("", response_model=OrderDetail, status_code=status.HTTP_201_CREATED)
def create_order(payload: OrderWrite, session: DatabaseSession) -> OrderDetail:
    if payload.order_status not in {
        OrderStatus.PENDING_CONFIRMATION,
        OrderStatus.CONFIRMED,
    }:
        raise HTTPException(status_code=422, detail="新订单只能设为待确认或已确认")

    _, cats = _validate_customer_and_cats(
        session,
        customer_id=payload.customer_id,
        cat_ids=payload.cat_ids,
    )
    order = build_order(payload, cats=cats)
    session.add(order)
    session.commit()
    return _order_detail(_load_order(session, order.id))


@router.get("/{order_id}", response_model=OrderDetail)
def get_order(order_id: int, session: DatabaseSession) -> OrderDetail:
    return _order_detail(_load_order(session, order_id))


@router.put("/{order_id}", response_model=OrderDetail)
def update_order(
    order_id: int,
    payload: OrderWrite,
    session: DatabaseSession,
) -> OrderDetail:
    order = _load_order(session, order_id)
    existing_cat_ids = {link.cat_id for link in order.cat_links}
    _, cats = _validate_customer_and_cats(
        session,
        customer_id=payload.customer_id,
        cat_ids=payload.cat_ids,
        allowed_inactive_ids=existing_cat_ids,
    )
    requested_items = [item.value for item in payload.service_items]
    structural_change = any(
        (
            order.customer_id != payload.customer_id,
            existing_cat_ids != set(payload.cat_ids),
            order.start_date != payload.start_date,
            order.end_date != payload.end_date,
            order.visits_per_day != payload.visits_per_day,
            order.service_items != requested_items,
        )
    )
    if order.customer_id != payload.customer_id and order.payments:
        raise HTTPException(
            status_code=409,
            detail="订单已有收款记录，不能更换客户",
        )
    if structural_change:
        require_tasks_are_rebuildable(order)
    if payload.order_status is OrderStatus.COMPLETED and structural_change:
        raise HTTPException(
            status_code=409,
            detail="不能在重建任务的同时把订单标记为已完成",
        )

    pricing = _pricing(payload)
    order.customer_id = payload.customer_id
    order.start_date = payload.start_date
    order.end_date = payload.end_date
    order.visits_per_day = payload.visits_per_day
    order.service_items = requested_items
    order.base_price = pricing.base_price
    order.extra_cat_fee = pricing.extra_cat_fee
    order.stairs_fee = pricing.stairs_fee
    order.other_fee = pricing.other_fee
    order.total_amount = pricing.total_amount
    order.payment_status = payment_status_for_amounts(
        total_amount=pricing.total_amount,
        paid_amount=order.paid_amount,
        current_status=order.payment_status,
    )
    order.notes = payload.notes

    if existing_cat_ids != set(payload.cat_ids):
        for link in list(order.cat_links):
            if link.cat_id not in payload.cat_ids:
                order.cat_links.remove(link)
        current_ids = {link.cat_id for link in order.cat_links}
        order.cat_links.extend(
            OrderCat(cat=cat) for cat in cats if cat.id not in current_ids
        )

    if structural_change:
        order.tasks.clear()
        order.order_status = payload.order_status
        generate_order_tasks(order)
    else:
        synchronize_task_statuses(order, payload.order_status)
        order.order_status = payload.order_status

    session.commit()
    return _order_detail(_load_order(session, order.id))


@router.patch("/{order_id}/status", response_model=OrderDetail)
def update_order_status(
    order_id: int,
    payload: OrderStatusUpdate,
    session: DatabaseSession,
) -> OrderDetail:
    order = _load_order(session, order_id)
    synchronize_task_statuses(order, payload.order_status)
    order.order_status = payload.order_status
    session.commit()
    return _order_detail(_load_order(session, order.id))
