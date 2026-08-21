from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.db.session import get_db
from app.models.customer import Cat, Customer
from app.schemas.customer import (
    CatCreate,
    CatRead,
    CatUpdate,
    CustomerCreate,
    CustomerDetail,
    CustomerListResponse,
    CustomerSearch,
    CustomerSummary,
    CustomerUpdate,
)


router = APIRouter(prefix="/api/admin/customers", tags=["admin-customers"])
DatabaseSession = Annotated[Session, Depends(get_db)]


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _customer_detail(customer: Customer) -> CustomerDetail:
    detail = CustomerDetail.model_validate(customer)
    detail.cats.sort(key=lambda cat: (not cat.is_active, cat.id))
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


def _list_customers(session: Session, search: str = "") -> CustomerListResponse:
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
            updated_at=customer.updated_at,
        )
        for customer, active_count, inactive_count in rows
    ]
    return CustomerListResponse(items=items, total=len(items))


@router.get("", response_model=CustomerListResponse)
def list_customers(session: DatabaseSession) -> CustomerListResponse:
    """Return a privacy-minimized customer list for the local admin page."""

    return _list_customers(session)


@router.post("/search", response_model=CustomerListResponse)
def search_customers(
    payload: CustomerSearch,
    session: DatabaseSession,
) -> CustomerListResponse:
    """Search without placing phone numbers or other terms in access-log URLs."""

    return _list_customers(session, payload.search)


@router.post("", response_model=CustomerDetail, status_code=status.HTTP_201_CREATED)
def create_customer(payload: CustomerCreate, session: DatabaseSession) -> CustomerDetail:
    customer = Customer(**payload.model_dump())
    session.add(customer)
    session.commit()
    return _customer_detail(_load_customer(session, customer.id))


@router.get("/{customer_id}", response_model=CustomerDetail)
def get_customer(customer_id: int, session: DatabaseSession) -> CustomerDetail:
    return _customer_detail(_load_customer(session, customer_id))


@router.patch("/{customer_id}", response_model=CustomerDetail)
def update_customer(
    customer_id: int,
    payload: CustomerUpdate,
    session: DatabaseSession,
) -> CustomerDetail:
    customer = _load_customer(session, customer_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(customer, field, value)
    session.commit()
    return _customer_detail(_load_customer(session, customer_id))


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
