from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.db.session import get_db
from app.maps import MapServices
from app.maps.factory import get_map_services
from app.models.customer import Cat, Customer
from app.models.enums import (
    OrderPaymentStatus,
    OrderSettlementMode,
    OrderStatus,
    TaskItemType,
)
from app.models.order import Order, OrderCat
from app.models.task import Task
from app.schemas.order import (
    OrderCreate,
    OrderCatOption,
    OrderCatSummary,
    OrderCustomerOption,
    OrderCustomerSummary,
    OrderDetail,
    OrderDailyReceivableRead,
    OrderFormOptions,
    OrderListResponse,
    OrderPatch,
    OrderServiceScheduleRead,
    OrderStatusUpdate,
    OrderSummary,
    OrderTaskItemRead,
    OrderTaskRead,
    OrderWrite,
    OrderServiceContact,
)
from app.schemas.location import LocationUpdateRead, OrderLocationRestore, OrderLocationUpdate
from app.services.order_customers import resolve_order_customer
from app.services.order_locations import clear_order_location, geocode_order
from app.services.manual_locations import (
    check_order_location_concurrency,
    update_order_location,
    verified_geocode,
)
from app.services.orders import (
    DEFAULT_BASE_PRICE,
    EXTRA_CAT_UNIT_PRICE,
    STAIRS_UNIT_PRICE,
    apply_service_contact,
    build_order,
    build_simple_order,
    calculate_order_pricing,
    cat_snapshot,
    customer_service_contact,
    due_amount,
    generate_order_tasks,
    money,
    order_has_execution_history,
    order_daily_receivables,
    order_display_address,
    order_geocode_address,
    order_schedule,
    order_service_days,
    order_service_contact,
    order_total_visits,
    overpaid_amount,
    payment_status_for_order,
    require_tasks_are_rebuildable,
    require_order_status_transition,
    replace_order_schedule,
    reprice_order,
    synchronize_task_statuses,
    apply_amount_adjustment,
)
from app.services.payments import payment_revision, require_payment_revision
from app.services.order_revisions import (
    order_payload_hash,
    order_write_revision,
    reserve_order_revision,
)


router = APIRouter(prefix="/api/admin/orders", tags=["admin-orders"])
DatabaseSession = Annotated[Session, Depends(get_db)]
MapServicesDependency = Annotated[MapServices, Depends(get_map_services)]
OrderRevisionHeader = Annotated[
    str,
    Header(alias="If-Match", pattern=r"^[0-9a-f]{64}$"),
]
IdempotencyKeyHeader = Annotated[
    str,
    Header(alias="Idempotency-Key", min_length=16, max_length=128),
]


def _order_load_options() -> tuple:
    return (
        selectinload(Order.customer).selectinload(Customer.cats),
        selectinload(Order.cat_links).selectinload(OrderCat.cat),
        selectinload(Order.service_dates),
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
    if order.cat_snapshot:
        return [
            OrderCatSummary(
                id=item.get("source_cat_id"),
                name=str(item.get("name") or f"猫咪 {index + 1}"),
                is_active=True,
            )
            for index, item in enumerate(order.cat_snapshot)
        ]
    return [
        OrderCatSummary(id=link.cat.id, name=link.cat.name, is_active=link.cat.is_active)
        for link in sorted(order.cat_links, key=lambda item: item.cat_id)
    ]


def _snapshot_display_address(order: Order) -> str | None:
    return order_display_address(order)


def _delete_block_reason(order: Order) -> str | None:
    if order.payments:
        return "订单已有收款流水，只能取消，不能永久删除"
    if order.order_status in {OrderStatus.IN_PROGRESS, OrderStatus.COMPLETED}:
        return "执行中或已完成订单只能保留历史记录"
    if order_has_execution_history(order):
        return "订单已有签到、完成事项、照片或执行时间记录，只能取消"
    return None


def _order_summary(order: Order, *, customer_resolution: str | None = None) -> OrderSummary:
    schedule = order_schedule(order)
    total_visits = order_total_visits(order)
    unit_price = (
        order.base_price
        if order.pricing_mode == "per_visit" or total_visits == 0
        else money(order.total_amount / total_visits)
    )
    service_contact = order_service_contact(order)
    delete_block_reason = _delete_block_reason(order)
    task_statuses = {
        service_date: next(
            (
                task.status
                for task in sorted(order.tasks, key=lambda item: (item.sort_order, item.id))
                if task.service_date == service_date
            ),
            None,
        )
        for service_date, _ in schedule
    }
    active_profile_cats = (
        sum(1 for cat in order.customer.cats if cat.is_active)
        if order.customer is not None
        else 0
    )
    return OrderSummary(
        id=order.id,
        write_revision=order_write_revision(order),
        source_customer_id=order.customer_id,
        service_contact=service_contact,
        cat_snapshot=order.cat_snapshot or [],
        customer=OrderCustomerSummary(
            id=order.customer_id,
            name=service_contact.name,
            community=service_contact.community,
            address=_snapshot_display_address(order),
        ),
        cats=_cat_summaries(order),
        start_date=order.start_date,
        end_date=order.end_date,
        visits_per_day=order.visits_per_day,
        service_days=order_service_days(order),
        total_visits=total_visits,
        cat_count=order.cat_count,
        service_schedule=[
            OrderServiceScheduleRead(service_date=value, visit_count=count)
            for value, count in schedule
        ],
        service_items=[TaskItemType(item) for item in order.service_items],
        pricing_mode=order.pricing_mode,
        settlement_mode=order.settlement_mode,
        amount_adjustment={
            "type": order.adjustment_type,
            "amount": order.adjustment_amount,
            "reason": order.adjustment_reason,
            "service_date": order.adjustment_service_date,
        },
        unit_price=unit_price,
        base_price=order.base_price,
        extra_cat_fee=order.extra_cat_fee,
        stairs_fee=order.stairs_fee,
        other_fee=order.other_fee,
        total_amount=order.total_amount,
        paid_amount=order.paid_amount,
        due_amount=due_amount(order),
        overpaid_amount=overpaid_amount(order),
        payment_status=order.payment_status,
        financial_revision=payment_revision(order),
        has_payment_history=bool(order.payments),
        daily_receivables=(
            [
                OrderDailyReceivableRead(
                    service_date=item.service_date,
                    expected_amount=item.expected_amount,
                    paid_amount=item.paid_amount,
                    due_amount=item.due_amount,
                    overpaid_amount=item.overpaid_amount,
                    task_status=task_statuses[item.service_date],
                )
                for item in order_daily_receivables(order)
            ]
            if order.settlement_mode is OrderSettlementMode.DAILY
            else []
        ),
        order_status=order.order_status,
        route_geocode_status=order.route_geocode_status,
        pending_cat_profile_count=max(order.cat_count - active_profile_cats, 0),
        customer_resolution=customer_resolution,
        is_demo_data=(
            order.customer is not None
            and order.customer.system_key == "catcare-demo-seed-v1"
        ),
        task_count=len(order.tasks),
        deletable=delete_block_reason is None,
        delete_block_reason=delete_block_reason,
        updated_at=order.updated_at,
    )


def _order_detail(order: Order, *, customer_resolution: str | None = None) -> OrderDetail:
    summary = _order_summary(order, customer_resolution=customer_resolution)
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


def _load_source_customer(
    session: Session,
    *,
    customer_id: int | None,
) -> Customer | None:
    if customer_id is None:
        return None
    customer = session.scalar(
        select(Customer)
        .options(selectinload(Customer.cats))
        .where(Customer.id == customer_id)
    )
    if customer is None:
        raise HTTPException(status_code=404, detail="客户档案不存在")
    return customer


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
        select(Customer)
        .options(selectinload(Customer.cats))
        .where(Customer.archived_at.is_(None))
        .order_by(Customer.name, Customer.id)
    ).all()
    return OrderFormOptions(
        customers=[
            OrderCustomerOption(
                id=customer.id,
                name=customer.name,
                wechat_name=customer.wechat_name,
                phone=customer.phone,
                community=customer.community,
                address=customer.address,
                building=customer.building,
                unit=customer.unit,
                room=customer.room,
                access_method=customer.access_method,
                community_access_method=customer.community_access_method,
                building_access_method=customer.building_access_method,
                access_info=customer.access_info,
                key_status=customer.key_status,
                key_code=customer.key_code,
                notes=customer.notes,
                is_repeat_customer=customer.is_repeat_customer,
                latitude=customer.latitude,
                longitude=customer.longitude,
                geocode_status=customer.geocode_status,
                cats=[
                    OrderCatOption(
                        id=cat.id,
                        name=cat.name,
                        photo_url=cat.photo_url,
                        gender=cat.gender,
                        age=cat.age,
                        breed=cat.breed,
                        personality=cat.personality,
                        food=cat.food,
                        food_preference=cat.food_preference,
                        litter_type=cat.litter_type,
                        medication_required=cat.medication_required,
                        medication_notes=cat.medication_notes,
                        special_notes=cat.special_notes,
                        service_notes=cat.service_notes,
                    )
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
def create_order(
    payload: OrderCreate | OrderWrite,
    session: DatabaseSession,
    services: MapServicesDependency,
    response: Response,
    idempotency_key: IdempotencyKeyHeader,
) -> OrderDetail:
    payload_hash = order_payload_hash(payload)
    existing = session.scalar(
        select(Order)
        .options(*_order_load_options())
        .where(Order.idempotency_key == idempotency_key)
    )
    if existing is not None:
        if existing.idempotency_payload_hash != payload_hash:
            raise HTTPException(status_code=409, detail="幂等键已用于不同的订单内容")
        response.status_code = status.HTTP_200_OK
        response.headers["Idempotent-Replayed"] = "true"
        return _order_detail(existing)

    if isinstance(payload, OrderCreate):
        explicit_customer_id = payload.source_customer_id or payload.customer_id
        selected_customer = _load_source_customer(
            session, customer_id=explicit_customer_id
        )
        contact = payload.service_contact
        if contact is None and selected_customer is not None:
            contact = customer_service_contact(selected_customer)
        if contact is None and payload.customer_name is not None:
            contact = OrderServiceContact(name=payload.customer_name)
        if contact is None:
            raise HTTPException(status_code=422, detail="订单缺少联系人信息")
        resolution = resolve_order_customer(
            session,
            contact=contact,
            explicit_customer_id=explicit_customer_id,
        )
        order = build_simple_order(payload, source_customer=resolution.customer)
        order.idempotency_key = idempotency_key
        order.idempotency_payload_hash = payload_hash
        session.add(order)
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            replay = session.scalar(
                select(Order)
                .options(*_order_load_options())
                .where(Order.idempotency_key == idempotency_key)
            )
            if replay is None or replay.idempotency_payload_hash != payload_hash:
                raise
            response.status_code = status.HTTP_200_OK
            response.headers["Idempotent-Replayed"] = "true"
            return _order_detail(replay)
        geocode_order(session, order.id, services)
        return _order_detail(
            _load_order(session, order.id), customer_resolution=resolution.result
        )

    if payload.order_status not in {
        OrderStatus.PENDING_CONFIRMATION,
        OrderStatus.CONFIRMED,
    }:
        raise HTTPException(status_code=422, detail="新订单只能设为待确认或已确认")

    customer, cats = _validate_customer_and_cats(
        session,
        customer_id=payload.customer_id,
        cat_ids=payload.cat_ids,
    )
    order = build_order(payload, cats=cats, customer=customer)
    order.idempotency_key = idempotency_key
    order.idempotency_payload_hash = payload_hash
    session.add(order)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        replay = session.scalar(
            select(Order)
            .options(*_order_load_options())
            .where(Order.idempotency_key == idempotency_key)
        )
        if replay is None or replay.idempotency_payload_hash != payload_hash:
            raise
        response.status_code = status.HTTP_200_OK
        response.headers["Idempotent-Replayed"] = "true"
        return _order_detail(replay)
    geocode_order(session, order.id, services)
    return _order_detail(_load_order(session, order.id))


@router.patch("/{order_id}", response_model=OrderDetail)
def patch_order(
    order_id: int,
    payload: OrderPatch,
    session: DatabaseSession,
    services: MapServicesDependency,
    expected_revision: OrderRevisionHeader,
) -> OrderDetail:
    order = _load_order(session, order_id)
    fields = payload.model_fields_set
    original_route_address = order_geocode_address(order)

    source_field_changed = bool({"customer_id", "source_customer_id"} & fields)
    requested_customer = order.customer
    if source_field_changed:
        requested_customer = _load_source_customer(
            session,
            customer_id=payload.source_customer_id or payload.customer_id,
        )
    requested_customer_id = (
        requested_customer.id if requested_customer is not None else None
    )
    source_changed = requested_customer_id != order.customer_id

    requested_dates = (
        [(service_date, 1) for service_date in payload.service_dates]
        if "service_dates" in fields and payload.service_dates is not None
        else order_schedule(order)
    )
    requested_items = (
        [item.value for item in payload.service_items]
        if "service_items" in fields and payload.service_items is not None
        else order.service_items
    )
    requested_cat_count = payload.cat_count if payload.cat_count is not None else order.cat_count
    structural_change = any(
        (
            source_changed,
            requested_dates != order_schedule(order),
            requested_items != order.service_items,
            requested_cat_count != order.cat_count,
        )
    )
    if structural_change:
        require_tasks_are_rebuildable(order)

    locked_financial_change = bool(
        {"service_dates", "settlement_mode", "amount_adjustment", "cat_count"}
        & fields
    )
    if order.payments and locked_financial_change:
        raise HTTPException(
            status_code=409,
            detail="订单已有收款记录，只能调整每次价格；日期、结算方式、金额变动和猫咪数量保持锁定",
        )

    price_changed = "unit_price" in fields and payload.unit_price is not None
    if order.payments and price_changed:
        if payload.expected_financial_revision is None:
            raise HTTPException(status_code=409, detail="请刷新订单后再调整价格")
        require_payment_revision(order, payload.expected_financial_revision)

    if source_changed and order.payments:
        raise HTTPException(status_code=409, detail="订单已有收款记录，不能更换客户来源")

    reserve_order_revision(session, order, expected_revision)

    if source_changed:
        order.customer_id = requested_customer_id
        order.cat_links.clear()
        for task in order.tasks:
            task.customer_id = requested_customer_id
        if requested_customer is not None:
            apply_service_contact(order, customer_service_contact(requested_customer))
            active_cats = [cat for cat in requested_customer.cats if cat.is_active]
            selected_cats = active_cats[:requested_cat_count]
            order.cat_snapshot = cat_snapshot(selected_cats)
            order.cat_links.extend(OrderCat(cat=cat) for cat in selected_cats)
    if "service_contact" in fields and payload.service_contact is not None:
        apply_service_contact(order, payload.service_contact)
    elif "customer_name" in fields and payload.customer_name is not None:
        service_contact = order_service_contact(order)
        apply_service_contact(
            order,
            service_contact.model_copy(update={"name": payload.customer_name}),
        )
    if "cat_snapshot" in fields and payload.cat_snapshot is not None:
        order.cat_snapshot = [
            item.model_dump(mode="json") for item in payload.cat_snapshot
        ]
    order.cat_count = requested_cat_count
    if requested_dates != order_schedule(order):
        replace_order_schedule(order, requested_dates)
    order.service_items = requested_items
    if "settlement_mode" in fields and payload.settlement_mode is not None:
        order.settlement_mode = payload.settlement_mode
    if "amount_adjustment" in fields and payload.amount_adjustment is not None:
        apply_amount_adjustment(order, payload.amount_adjustment)
    if "notes" in fields:
        order.notes = payload.notes

    if price_changed or structural_change or "amount_adjustment" in fields:
        reprice_order(order, unit_price=payload.unit_price if price_changed else None)

    if structural_change:
        order.tasks.clear()
        generate_order_tasks(order)

    address_changed = original_route_address != order_geocode_address(order)
    if address_changed:
        clear_order_location(order)
    session.commit()
    if address_changed:
        geocode_order(session, order.id, services)
    return _order_detail(_load_order(session, order.id))


@router.get("/{order_id}", response_model=OrderDetail)
def get_order(order_id: int, session: DatabaseSession) -> OrderDetail:
    return _order_detail(_load_order(session, order_id))


@router.post("/{order_id}/geocode", response_model=OrderDetail)
def retry_order_geocode(
    order_id: int,
    session: DatabaseSession,
    services: MapServicesDependency,
    expected_revision: OrderRevisionHeader,
) -> OrderDetail:
    order = _load_order(session, order_id)
    reserve_order_revision(session, order, expected_revision)
    session.commit()
    geocode_order(session, order_id, services)
    return _order_detail(_load_order(session, order_id))


@router.patch("/{order_id}/location", response_model=LocationUpdateRead)
def patch_order_location(
    order_id: int,
    payload: OrderLocationUpdate,
    session: DatabaseSession,
) -> LocationUpdateRead:
    result = update_order_location(
        session,
        order_id=order_id,
        service_date=payload.service_date,
        expected_order_updated_at=payload.expected_order_updated_at,
        expected_day_revision=payload.expected_day_revision,
        latitude=payload.latitude,
        longitude=payload.longitude,
    )
    session.commit()
    return result


@router.post("/{order_id}/location/restore-auto", response_model=LocationUpdateRead)
def restore_order_location(
    order_id: int,
    payload: OrderLocationRestore,
    session: DatabaseSession,
    services: MapServicesDependency,
) -> LocationUpdateRead:
    _, order = check_order_location_concurrency(
        session,
        order_id=order_id,
        service_date=payload.service_date,
        expected_order_updated_at=payload.expected_order_updated_at,
        expected_day_revision=payload.expected_day_revision,
    )
    result, provider_name = verified_geocode(order, services)
    session.expire_all()
    updated = update_order_location(
        session,
        order_id=order_id,
        service_date=payload.service_date,
        expected_order_updated_at=payload.expected_order_updated_at,
        expected_day_revision=payload.expected_day_revision,
        latitude=result.point.latitude,
        longitude=result.point.longitude,
        automatic_result=result,
        provider_name=provider_name,
    )
    session.commit()
    return updated


@router.put("/{order_id}", response_model=OrderDetail)
def update_order(
    order_id: int,
    payload: OrderWrite,
    session: DatabaseSession,
    services: MapServicesDependency,
    expected_revision: OrderRevisionHeader,
) -> OrderDetail:
    order = _load_order(session, order_id)
    existing_cat_ids = {link.cat_id for link in order.cat_links}
    customer, cats = _validate_customer_and_cats(
        session,
        customer_id=payload.customer_id,
        cat_ids=payload.cat_ids,
        allowed_inactive_ids=existing_cat_ids,
    )
    requested_items = [item.value for item in payload.service_items]
    requested_schedule = [
        (payload.start_date + timedelta(days=offset), payload.visits_per_day)
        for offset in range((payload.end_date - payload.start_date).days + 1)
    ]
    pricing = _pricing(payload)
    structural_change = any(
        (
            order.customer_id != payload.customer_id,
            existing_cat_ids != set(payload.cat_ids),
            order_schedule(order) != requested_schedule,
            order.service_items != requested_items,
        )
    )
    if order.customer_id != payload.customer_id and order.payments:
        raise HTTPException(
            status_code=409,
            detail="订单已有收款记录，不能更换客户",
        )
    if order.payments and any(
        (
            existing_cat_ids != set(payload.cat_ids),
            order_schedule(order) != requested_schedule,
            payload.settlement_mode != order.settlement_mode,
            payload.amount_adjustment.type != order.adjustment_type,
            money(payload.amount_adjustment.amount) != money(order.adjustment_amount),
            payload.amount_adjustment.reason != order.adjustment_reason,
            payload.amount_adjustment.service_date != order.adjustment_service_date,
            pricing.base_price != money(order.base_price),
            pricing.extra_cat_fee != money(order.extra_cat_fee),
            pricing.stairs_fee != money(order.stairs_fee),
            pricing.other_fee != money(order.other_fee),
            pricing.total_amount != money(order.total_amount),
        )
    ):
        raise HTTPException(
            status_code=409,
            detail="订单已有收款记录，兼容更新接口不能修改财务字段；请使用订单价格调整",
        )
    if structural_change:
        require_tasks_are_rebuildable(order)
    if payload.order_status is OrderStatus.COMPLETED and structural_change:
        raise HTTPException(
            status_code=409,
            detail="不能在重建任务的同时把订单标记为已完成",
        )

    require_order_status_transition(order, payload.order_status)
    reserve_order_revision(session, order, expected_revision)

    order.customer_id = payload.customer_id
    apply_service_contact(order, customer_service_contact(customer))
    order.cat_snapshot = cat_snapshot(cats)
    order.cat_count = len(cats)
    order.service_items = requested_items
    order.pricing_mode = "legacy_components"
    order.base_price = pricing.base_price
    order.extra_cat_fee = pricing.extra_cat_fee
    order.stairs_fee = pricing.stairs_fee
    order.other_fee = pricing.other_fee
    order.total_amount = pricing.total_amount
    order.payment_status = payment_status_for_order(order)
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
        replace_order_schedule(order, requested_schedule)
        order.visits_per_day = payload.visits_per_day
        order.tasks.clear()
        order.order_status = payload.order_status
        generate_order_tasks(order)
    else:
        synchronize_task_statuses(order, payload.order_status)
        order.order_status = payload.order_status

    session.commit()
    geocode_order(session, order.id, services)
    return _order_detail(_load_order(session, order.id))


@router.patch("/{order_id}/status", response_model=OrderDetail)
def update_order_status(
    order_id: int,
    payload: OrderStatusUpdate,
    session: DatabaseSession,
    expected_revision: OrderRevisionHeader,
) -> OrderDetail:
    order = _load_order(session, order_id)
    require_order_status_transition(order, payload.order_status)
    reserve_order_revision(session, order, expected_revision)
    synchronize_task_statuses(order, payload.order_status)
    order.order_status = payload.order_status
    session.commit()
    return _order_detail(_load_order(session, order.id))


@router.delete("/{order_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_order(
    order_id: int,
    session: DatabaseSession,
    expected_revision: OrderRevisionHeader,
) -> None:
    order = _load_order(session, order_id)
    reason = _delete_block_reason(order)
    if reason is not None:
        raise HTTPException(status_code=409, detail=reason)
    reserve_order_revision(session, order, expected_revision)
    session.delete(order)
    session.commit()
