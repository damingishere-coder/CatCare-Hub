from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.enums import (
    OrderPaymentStatus,
    OrderStatus,
    PaymentMethod,
    PaymentRecordStatus,
    OrderSettlementMode,
    TaskStatus,
)


class PaymentCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    order_id: int = Field(gt=0)
    service_date: date | None = None
    amount: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    payment_method: PaymentMethod
    paid_at: datetime
    notes: str | None = Field(default=None, max_length=2000)
    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")

    @field_validator("notes", mode="before")
    @classmethod
    def normalize_notes(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip() or None
        return value

    @field_validator("paid_at")
    @classmethod
    def require_paid_at_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("收款时间必须包含明确时区")
        return value


class PaymentMetrics(BaseModel):
    today_income: Decimal = Field(ge=0)
    pending_order_count: int = Field(ge=0)
    month_income: Decimal = Field(ge=0)
    completed_order_count: int = Field(ge=0)


class PaymentReceivable(BaseModel):
    order_id: int
    settlement_mode: OrderSettlementMode
    service_date: date | None
    customer_name: str
    community: str | None
    address: str | None
    start_date: date
    end_date: date
    cat_count: int = Field(ge=0)
    total_amount: Decimal = Field(ge=0)
    paid_amount: Decimal = Field(ge=0)
    due_amount: Decimal = Field(ge=0)
    overpaid_amount: Decimal = Field(ge=0)
    payment_status: OrderPaymentStatus
    order_status: OrderStatus
    task_status: TaskStatus | None
    revision: str = Field(pattern=r"^[0-9a-f]{64}$")


class PaymentRecordRead(BaseModel):
    id: int
    order_id: int
    service_date: date | None
    customer_name: str
    start_date: date
    end_date: date
    cat_count: int = Field(ge=0)
    amount: Decimal = Field(gt=0)
    payment_method: PaymentMethod
    payment_status: PaymentRecordStatus
    paid_at: datetime | None
    voided_at: datetime | None
    voided_reason: str | None
    revision: str = Field(pattern=r"^[0-9a-f]{64}$")


class PaymentsOverview(BaseModel):
    business_date: date
    month_start: date
    metrics: PaymentMetrics
    receivables: list[PaymentReceivable]
    records: list[PaymentRecordRead]


class PaymentRegistration(BaseModel):
    payment: PaymentRecordRead
    order: PaymentReceivable


class PaymentVoidRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")
    reason: str = Field(min_length=1, max_length=500)


class PaymentVoidResult(BaseModel):
    payment: PaymentRecordRead
    order_id: int
    paid_amount: Decimal = Field(ge=0)
    due_amount: Decimal = Field(ge=0)
    overpaid_amount: Decimal = Field(ge=0)
    payment_status: OrderPaymentStatus
    revision: str = Field(pattern=r"^[0-9a-f]{64}$")
