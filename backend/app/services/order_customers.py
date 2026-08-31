from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.customer import Customer
from app.schemas.order import OrderServiceContact


@dataclass(frozen=True)
class CustomerResolution:
    customer: Customer
    result: str


def _text(value: str | None) -> str:
    return " ".join((value or "").strip().casefold().split())


def _phone(value: str | None) -> str:
    return "".join(character for character in (value or "") if character.isdigit())


def _full_address(values: object) -> str:
    parts = [
        getattr(values, field, None)
        for field in ("address", "community", "building", "unit", "room")
    ]
    return _text(" ".join(str(part) for part in parts if part))


def _ambiguous(stage: str, customers: list[Customer]) -> None:
    raise HTTPException(
        status_code=409,
        detail={
            "code": "customer_match_ambiguous",
            "message": "找到多个可能的客户档案，请在订单中明确选择客户",
            "match_stage": stage,
            "candidates": [
                {"id": customer.id, "name": customer.name}
                for customer in sorted(customers, key=lambda item: item.id)
            ],
        },
    )


def _fill_empty_fields(customer: Customer, contact: OrderServiceContact) -> None:
    if (
        contact.community_access_method is not None
        or contact.building_access_method is not None
    ):
        customer.access_method = None
    for field in (
        "wechat_name",
        "phone",
        "community",
        "address",
        "building",
        "unit",
        "room",
        "access_method",
        "community_access_method",
        "building_access_method",
        "access_info",
        "key_status",
        "key_code",
        "notes",
    ):
        if not getattr(customer, field) and getattr(contact, field):
            setattr(customer, field, getattr(contact, field))
    customer.is_repeat_customer = customer.is_repeat_customer or contact.is_repeat_customer
    if customer.latitude is None and contact.latitude is not None:
        customer.latitude = contact.latitude
    if customer.longitude is None and contact.longitude is not None:
        customer.longitude = contact.longitude
    if customer.geocode_status is None and contact.geocode_status is not None:
        customer.geocode_status = contact.geocode_status
    if customer.archived_at is not None:
        customer.archived_at = None


def resolve_order_customer(
    session: Session,
    *,
    contact: OrderServiceContact,
    explicit_customer_id: int | None,
) -> CustomerResolution:
    if explicit_customer_id is not None:
        customer = session.scalar(
            select(Customer)
            .options(selectinload(Customer.cats))
            .where(Customer.id == explicit_customer_id)
        )
        if customer is None:
            raise HTTPException(status_code=404, detail="客户档案不存在")
        if customer.archived_at is not None:
            customer.archived_at = None
        return CustomerResolution(customer=customer, result="selected")

    customers = list(
        session.scalars(select(Customer).options(selectinload(Customer.cats)))
    )
    stages: list[tuple[str, list[Customer]]] = []
    normalized_phone = _phone(contact.phone)
    if normalized_phone:
        stages.append(
            (
                "phone",
                [customer for customer in customers if _phone(customer.phone) == normalized_phone],
            )
        )
    normalized_wechat = _text(contact.wechat_name)
    if normalized_wechat:
        stages.append(
            (
                "wechat",
                [
                    customer
                    for customer in customers
                    if _text(customer.wechat_name) == normalized_wechat
                ],
            )
        )
    normalized_name = _text(contact.name)
    normalized_address = _full_address(contact)
    if normalized_name and normalized_address:
        stages.append(
            (
                "name_address",
                [
                    customer
                    for customer in customers
                    if _text(customer.name) == normalized_name
                    and _full_address(customer) == normalized_address
                ],
            )
        )

    for stage, matches in stages:
        if len(matches) > 1:
            _ambiguous(stage, matches)
        if len(matches) == 1:
            customer = matches[0]
            _fill_empty_fields(customer, contact)
            return CustomerResolution(customer=customer, result=f"matched_{stage}")

    customer = Customer(
        name=contact.name,
        wechat_name=contact.wechat_name,
        phone=contact.phone,
        community=contact.community,
        address=contact.address,
        building=contact.building,
        unit=contact.unit,
        room=contact.room,
        access_method=contact.access_method,
        community_access_method=contact.community_access_method,
        building_access_method=contact.building_access_method,
        access_info=contact.access_info,
        key_status=contact.key_status,
        key_code=contact.key_code,
        notes=contact.notes,
        is_repeat_customer=contact.is_repeat_customer,
        latitude=contact.latitude,
        longitude=contact.longitude,
        geocode_status=(
            contact.geocode_status
            or ("pending" if _full_address(contact) else "missing")
        ),
        archived_at=None,
    )
    session.add(customer)
    session.flush()
    return CustomerResolution(customer=customer, result="created")
