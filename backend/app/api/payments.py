from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.payment import (
    PaymentCreate,
    PaymentRegistration,
    PaymentVoidRequest,
    PaymentVoidResult,
    PaymentsOverview,
)
from app.services.payments import get_payments_overview, register_payment, void_payment


router = APIRouter(prefix="/api/admin/payments", tags=["admin-payments"])
DatabaseSession = Annotated[Session, Depends(get_db)]
BusinessDateQuery = Annotated[date | None, Query(alias="date")]


@router.get("", response_model=PaymentsOverview)
def read_payments_overview(
    session: DatabaseSession,
    business_date: BusinessDateQuery = None,
) -> PaymentsOverview:
    return get_payments_overview(session, business_date)


@router.post("", response_model=PaymentRegistration, status_code=status.HTTP_201_CREATED)
def create_payment(
    payload: PaymentCreate,
    session: DatabaseSession,
) -> PaymentRegistration:
    return register_payment(session, payload)


@router.post("/{payment_id}/void", response_model=PaymentVoidResult)
def void_payment_record(
    payment_id: int,
    payload: PaymentVoidRequest,
    session: DatabaseSession,
) -> PaymentVoidResult:
    return void_payment(session, payment_id, payload)
