from datetime import date, datetime, time
from decimal import Decimal
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.enums import OrderPaymentStatus, OrderStatus, TaskItemType, TaskStatus


class NormalizedOrderModel(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    @field_validator("*", mode="before")
    @classmethod
    def normalize_strings(cls, value: object) -> object:
        if isinstance(value, str):
            normalized = value.strip()
            return normalized or None
        return value


class OrderWrite(NormalizedOrderModel):
    customer_id: int = Field(gt=0)
    cat_ids: list[int] = Field(min_length=1, max_length=50)
    start_date: date
    end_date: date
    visits_per_day: int = Field(ge=1, le=10)
    service_items: list[TaskItemType] = Field(min_length=1, max_length=8)
    base_price: Decimal = Field(
        default=Decimal("30.00"),
        ge=0,
        max_digits=10,
        decimal_places=2,
    )
    stairs_fee: Decimal = Field(
        default=Decimal("0.00"),
        ge=0,
        max_digits=10,
        decimal_places=2,
    )
    other_fee: Decimal = Field(
        default=Decimal("0.00"),
        ge=0,
        max_digits=10,
        decimal_places=2,
    )
    order_status: OrderStatus = OrderStatus.PENDING_CONFIRMATION
    notes: str | None = Field(default=None, max_length=4000)

    @field_validator("cat_ids")
    @classmethod
    def reject_duplicate_cats(cls, cat_ids: list[int]) -> list[int]:
        if any(cat_id <= 0 for cat_id in cat_ids):
            raise ValueError("猫咪 ID 必须为正整数")
        if len(cat_ids) != len(set(cat_ids)):
            raise ValueError("不能重复选择同一只猫咪")
        return cat_ids

    @field_validator("service_items")
    @classmethod
    def deduplicate_service_items(
        cls,
        service_items: list[TaskItemType],
    ) -> list[TaskItemType]:
        return list(dict.fromkeys(service_items))

    @field_validator("stairs_fee")
    @classmethod
    def validate_stairs_fee(cls, value: Decimal) -> Decimal:
        if value not in {Decimal("0"), Decimal("5")}:
            raise ValueError("爬楼费只能是 0 元或 5 元/次")
        return value

    @model_validator(mode="after")
    def validate_date_range(self) -> Self:
        if self.end_date < self.start_date:
            raise ValueError("结束日期不能早于开始日期")
        service_days = (self.end_date - self.start_date).days + 1
        if service_days > 366:
            raise ValueError("订单日期范围不能超过 366 天")
        return self


class OrderStatusUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    order_status: OrderStatus


class OrderCatSummary(BaseModel):
    id: int
    name: str
    is_active: bool


class OrderCustomerSummary(BaseModel):
    id: int
    name: str
    community: str | None


class OrderTaskItemRead(BaseModel):
    item_type: TaskItemType
    required: bool
    completed: bool


class OrderTaskRead(BaseModel):
    id: int
    service_date: date
    planned_time: time | None
    sort_order: int
    status: TaskStatus
    items: list[OrderTaskItemRead]


class OrderSummary(BaseModel):
    id: int
    customer: OrderCustomerSummary
    cats: list[OrderCatSummary]
    start_date: date
    end_date: date
    visits_per_day: int
    service_days: int
    total_visits: int
    service_items: list[TaskItemType]
    base_price: Decimal
    extra_cat_fee: Decimal
    stairs_fee: Decimal
    other_fee: Decimal
    total_amount: Decimal
    paid_amount: Decimal
    due_amount: Decimal
    payment_status: OrderPaymentStatus
    order_status: OrderStatus
    task_count: int
    updated_at: datetime


class OrderDetail(OrderSummary):
    notes: str | None
    tasks: list[OrderTaskRead]
    created_at: datetime


class OrderListResponse(BaseModel):
    items: list[OrderSummary]
    total: int


class OrderCatOption(BaseModel):
    id: int
    name: str


class OrderCustomerOption(BaseModel):
    id: int
    name: str
    community: str | None
    cats: list[OrderCatOption]


class OrderFormOptions(BaseModel):
    customers: list[OrderCustomerOption]
    default_base_price: Decimal
    extra_cat_unit_price: Decimal
    stairs_unit_price: Decimal
