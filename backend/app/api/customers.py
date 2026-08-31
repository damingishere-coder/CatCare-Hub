from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.db.session import get_db
from app.maps import MapServices
from app.maps.factory import get_map_services
from app.models.customer import Cat, Customer
from app.models.order import Order, OrderCat
from app.models.payment import Payment
from app.models.task import Task
from app.schemas.customer import (
    CatCreate,
    CatRead,
    CatUpdate,
    CustomerArchiveUpdate,
    CustomerCreate,
    CustomerDetail,
    CustomerListResponse,
    CustomerSearch,
    CustomerSummary,
    CustomerUpdate,
)
from app.schemas.location import CustomerLocationRestore, CustomerLocationUpdate, LocationUpdateRead
from app.services.customers import build_customer
from app.services.manual_locations import (
    check_customer_location_concurrency,
    update_customer_location,
    verified_geocode,
)


router = APIRouter(prefix="/api/admin/customers", tags=["admin-customers"])
DatabaseSession = Annotated[Session, Depends(get_db)]
MapServicesDependency = Annotated[MapServices, Depends(get_map_services)]
GEOCODE_ADDRESS_FIELDS = {"community", "address", "building", "unit", "room"}


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _pending_cat_profile_count(session: Session, customer: Customer) -> int:
    ordered_cat_count = int(
        session.scalar(
            select(func.max(Order.cat_count)).where(Order.customer_id == customer.id)
        )
        or 0
    )
    active_cat_count = sum(1 for cat in customer.cats if cat.is_active)
    return max(ordered_cat_count - active_cat_count, 0)


def _customer_detail(session: Session, customer: Customer) -> CustomerDetail:
    detail = CustomerDetail.model_validate(customer)
    detail.cats.sort(key=lambda cat: (not cat.is_active, cat.id))
    detail.pending_cat_profile_count = _pending_cat_profile_count(session, customer)
    return detail


def _load_customer(session: Session, customer_id: int) -> Customer:
    customer = session.scalar(
        select(Customer)
        .options(selectinload(Customer.cats))
        .where(Customer.id == customer_id)
    )
    if customer is None:
        raise HTTPException(status_code=404, detail="客户不存在")
    return customer


def _list_customers(
    session: Session,
    search: str = "",
    *,
    include_archived: bool = False,
) -> CustomerListResponse:
    counts = (
        select(
            Cat.customer_id.label("customer_id"),
            func.sum(case((Cat.is_active.is_(True), 1), else_=0)).label(
                "active_cat_count"
            ),
            func.sum(case((Cat.is_active.is_(False), 1), else_=0)).label(
                "inactive_cat_count"
            ),
        )
        .group_by(Cat.customer_id)
        .subquery()
    )
    statement = (
        select(
            Customer,
            func.coalesce(counts.c.active_cat_count, 0),
            func.coalesce(counts.c.inactive_cat_count, 0),
        )
        .outerjoin(counts, counts.c.customer_id == Customer.id)
        .order_by(Customer.updated_at.desc(), Customer.id.desc())
    )
    if not include_archived:
        statement = statement.where(Customer.archived_at.is_(None))

    if search:
        pattern = f"%{_escape_like(search)}%"
        statement = statement.where(
            or_(
                Customer.name.ilike(pattern, escape="\\"),
                Customer.wechat_name.ilike(pattern, escape="\\"),
                Customer.phone.ilike(pattern, escape="\\"),
                Customer.community.ilike(pattern, escape="\\"),
                Customer.cats.any(Cat.name.ilike(pattern, escape="\\")),
            )
        )

    rows = session.execute(statement).all()
    items = [
        CustomerSummary(
            id=customer.id,
            name=customer.name,
            wechat_name=customer.wechat_name,
            phone=customer.phone,
            community=customer.community,
            is_repeat_customer=customer.is_repeat_customer,
            active_cat_count=int(active_count),
            inactive_cat_count=int(inactive_count),
            pending_cat_profile_count=max(
                int(
                    session.scalar(
                        select(func.max(Order.cat_count)).where(
                            Order.customer_id == customer.id
                        )
                    )
                    or 0
                )
                - int(active_count),
                0,
            ),
            archived_at=customer.archived_at,
            updated_at=customer.updated_at,
        )
        for customer, active_count, inactive_count in rows
    ]
    return CustomerListResponse(items=items, total=len(items))


@router.get("", response_model=CustomerListResponse)
def list_customers(
    session: DatabaseSession,
    include_archived: bool = False,
) -> CustomerListResponse:
    """Return a privacy-minimized customer list for the local admin page."""

    return _list_customers(session, include_archived=include_archived)


@router.post("/search", response_model=CustomerListResponse)
def search_customers(
    payload: CustomerSearch,
    session: DatabaseSession,
) -> CustomerListResponse:
    """Search without placing phone numbers or other terms in access-log URLs."""

    return _list_customers(
        session,
        payload.search,
        include_archived=payload.include_archived,
    )


@router.post("", response_model=CustomerDetail, status_code=status.HTTP_201_CREATED)
def create_customer(payload: CustomerCreate, session: DatabaseSession) -> CustomerDetail:
    customer = build_customer(payload)
    session.add(customer)
    session.commit()
    return _customer_detail(session, _load_customer(session, customer.id))


@router.get("/{customer_id}", response_model=CustomerDetail)
def get_customer(customer_id: int, session: DatabaseSession) -> CustomerDetail:
    return _customer_detail(session, _load_customer(session, customer_id))


@router.patch("/{customer_id}/location", response_model=LocationUpdateRead)
def patch_customer_location(
    customer_id: int,
    payload: CustomerLocationUpdate,
    session: DatabaseSession,
) -> LocationUpdateRead:
    result = update_customer_location(
        session,
        customer_id=customer_id,
        source_order_id=payload.source_order_id,
        service_date=payload.service_date,
        expected_customer_updated_at=payload.expected_customer_updated_at,
        expected_day_revision=payload.expected_day_revision,
        latitude=payload.latitude,
        longitude=payload.longitude,
    )
    session.commit()
    return result


@router.post("/{customer_id}/location/restore-auto", response_model=LocationUpdateRead)
def restore_customer_location(
    customer_id: int,
    payload: CustomerLocationRestore,
    session: DatabaseSession,
    services: MapServicesDependency,
) -> LocationUpdateRead:
    _, order, _ = check_customer_location_concurrency(
        session,
        customer_id=customer_id,
        source_order_id=payload.source_order_id,
        service_date=payload.service_date,
        expected_customer_updated_at=payload.expected_customer_updated_at,
        expected_day_revision=payload.expected_day_revision,
    )
    result, provider_name = verified_geocode(order, services)
    session.expire_all()
    updated = update_customer_location(
        session,
        customer_id=customer_id,
        source_order_id=payload.source_order_id,
        service_date=payload.service_date,
        expected_customer_updated_at=payload.expected_customer_updated_at,
        expected_day_revision=payload.expected_day_revision,
        latitude=result.point.latitude,
        longitude=result.point.longitude,
        automatic_result=result,
        provider_name=provider_name,
    )
    session.commit()
    return updated


@router.patch("/{customer_id}", response_model=CustomerDetail)
def update_customer(
    customer_id: int,
    payload: CustomerUpdate,
    session: DatabaseSession,
) -> CustomerDetail:
    customer = _load_customer(session, customer_id)
    updates = payload.model_dump(exclude_unset=True)
    if updates.get("community_access_method") is not None or updates.get(
        "building_access_method"
    ) is not None:
        updates["access_method"] = None
    address_changed = any(
        field in GEOCODE_ADDRESS_FIELDS and getattr(customer, field) != value
        for field, value in updates.items()
    )
    for field, value in updates.items():
        setattr(customer, field, value)
    if address_changed:
        customer.latitude = None
        customer.longitude = None
        customer.geocode_fingerprint = None
        customer.geocode_adcode = None
        customer.geocode_level = None
        customer.geocode_status = (
            "pending"
            if any(
                getattr(customer, field)
                for field in ("community", "address", "building")
            )
            else "missing"
        )
    session.commit()
    return _customer_detail(session, _load_customer(session, customer_id))


@router.patch("/{customer_id}/archive", response_model=CustomerDetail)
def archive_customer(
    customer_id: int,
    payload: CustomerArchiveUpdate,
    session: DatabaseSession,
) -> CustomerDetail:
    customer = _load_customer(session, customer_id)
    customer.archived_at = datetime.now(timezone.utc) if payload.archived else None
    session.commit()
    return _customer_detail(session, _load_customer(session, customer_id))


@router.delete("/{customer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_customer(customer_id: int, session: DatabaseSession) -> None:
    customer = _load_customer(session, customer_id)
    direct_history_count = sum(
        int(session.scalar(statement) or 0)
        for statement in (
            select(func.count(Order.id)).where(Order.customer_id == customer_id),
            select(func.count(Task.id)).where(Task.customer_id == customer_id),
            select(func.count(Payment.id)).where(Payment.customer_id == customer_id),
        )
    )
    linked_cat_count = int(
        session.scalar(
            select(func.count(OrderCat.order_id))
            .join(Cat, Cat.id == OrderCat.cat_id)
            .where(Cat.customer_id == customer_id)
        )
        or 0
    )
    if direct_history_count or linked_cat_count:
        raise HTTPException(
            status_code=409,
            detail="客户已有订单、任务或收款历史，请改用归档",
        )
    session.delete(customer)
    session.commit()


@router.post(
    "/{customer_id}/cats",
    response_model=CatRead,
    status_code=status.HTTP_201_CREATED,
)
def create_cat(
    customer_id: int,
    payload: CatCreate,
    session: DatabaseSession,
) -> CatRead:
    if session.get(Customer, customer_id) is None:
        raise HTTPException(status_code=404, detail="客户不存在")

    cat = Cat(customer_id=customer_id, **payload.model_dump())
    session.add(cat)
    session.commit()
    session.refresh(cat)
    return CatRead.model_validate(cat)


@router.patch("/{customer_id}/cats/{cat_id}", response_model=CatRead)
def update_cat(
    customer_id: int,
    cat_id: int,
    payload: CatUpdate,
    session: DatabaseSession,
) -> CatRead:
    cat = session.scalar(
        select(Cat).where(Cat.id == cat_id, Cat.customer_id == customer_id)
    )
    if cat is None:
        raise HTTPException(status_code=404, detail="猫咪不存在或不属于该客户")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(cat, field, value)
    session.commit()
    session.refresh(cat)
    return CatRead.model_validate(cat)
    CustomerArchiveUpdate,
