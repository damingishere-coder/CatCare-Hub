from datetime import date, datetime, time
from decimal import Decimal
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.enums import (
    OrderAdjustmentType,
    OrderPaymentStatus,
    OrderSettlementMode,
    OrderStatus,
    TaskItemType,
    TaskStatus,
)


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
    settlement_mode: OrderSettlementMode = OrderSettlementMode.DAILY
    amount_adjustment: "OrderAmountAdjustment" = Field(
        default_factory=lambda: OrderAmountAdjustment()
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


def _normalized_service_dates(values: list[date]) -> list[date]:
    unique = sorted(set(values))
    if len(unique) != len(values):
        raise ValueError("服务日期不能重复")
    return unique


class OrderAmountAdjustment(NormalizedOrderModel):
    type: OrderAdjustmentType = OrderAdjustmentType.NONE
    amount: Decimal = Field(
        default=Decimal("0.00"), ge=0, max_digits=10, decimal_places=2
    )
    reason: str | None = Field(default=None, max_length=1000)
    service_date: date | None = None

    @model_validator(mode="after")
    def validate_adjustment(self) -> Self:
        if self.type is OrderAdjustmentType.NONE:
            if self.amount != 0 or self.service_date is not None or self.reason is not None:
                raise ValueError("无金额变动时不能填写金额、原因或服务日期")
            return self
        if self.amount <= 0:
            raise ValueError("加收或减免金额必须大于 0")
        if self.service_date is None:
            raise ValueError("加收或减免必须指定服务日期")
        if self.reason is None:
            raise ValueError("加收或减免必须填写原因")
        return self


class OrderServiceContact(NormalizedOrderModel):
    name: str = Field(min_length=1, max_length=100)
    wechat_name: str | None = Field(default=None, max_length=100)
    phone: str | None = Field(default=None, max_length=32)
    community: str | None = Field(default=None, max_length=200)
    address: str | None = Field(default=None, max_length=1000)
    building: str | None = Field(default=None, max_length=50)
    unit: str | None = Field(default=None, max_length=50)
    room: str | None = Field(default=None, max_length=50)
    access_method: str | None = Field(default=None, max_length=100)
    access_info: str | None = Field(default=None, max_length=4000)
    key_status: str | None = Field(default=None, max_length=50)
    key_code: str | None = Field(default=None, max_length=100)
    notes: str | None = Field(default=None, max_length=4000)
    is_repeat_customer: bool = False
    latitude: Decimal | None = Field(default=None, ge=-90, le=90)
    longitude: Decimal | None = Field(default=None, ge=-180, le=180)
    geocode_status: str | None = Field(default=None, max_length=32)


class OrderCatSnapshot(NormalizedOrderModel):
    source_cat_id: int | None = Field(default=None, gt=0)
    name: str = Field(min_length=1, max_length=100)
    photo_url: str | None = Field(default=None, max_length=500)
    gender: str | None = Field(default=None, max_length=32)
    age: Decimal | None = Field(default=None, ge=0, le=999)
    breed: str | None = Field(default=None, max_length=100)
    personality: str | None = Field(default=None, max_length=4000)
    food: str | None = Field(default=None, max_length=4000)
    food_preference: str | None = Field(default=None, max_length=4000)
    litter_type: str | None = Field(default=None, max_length=100)
    medication_required: bool = False
    medication_notes: str | None = Field(default=None, max_length=4000)
    special_notes: str | None = Field(default=None, max_length=4000)
    service_notes: str | None = Field(default=None, max_length=4000)


class OrderCreate(NormalizedOrderModel):
    source_customer_id: int | None = Field(default=None, gt=0)
    service_contact: OrderServiceContact | None = None
    cat_snapshot: list[OrderCatSnapshot] = Field(default_factory=list, max_length=50)
    # 兼容旧客户端；它们只作为订单快照输入，不会自动创建客户档案。
    customer_id: int | None = Field(default=None, gt=0)
    customer_name: str | None = Field(default=None, min_length=1, max_length=100)
    cat_count: int = Field(ge=1, le=50)
    service_dates: list[date] = Field(min_length=1, max_length=366)
    service_items: list[TaskItemType] = Field(min_length=1, max_length=8)
    unit_price: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
    settlement_mode: OrderSettlementMode = OrderSettlementMode.DAILY
    amount_adjustment: OrderAmountAdjustment = Field(
        default_factory=OrderAmountAdjustment
    )
    notes: str | None = Field(default=None, max_length=4000)

    @field_validator("service_dates")
    @classmethod
    def normalize_service_dates(cls, values: list[date]) -> list[date]:
        return _normalized_service_dates(values)

    @field_validator("service_items")
    @classmethod
    def normalize_service_items(
        cls, values: list[TaskItemType]
    ) -> list[TaskItemType]:
        return list(dict.fromkeys(values))

    @model_validator(mode="after")
    def require_customer_reference(self) -> Self:
        customer_ids = [
            value
            for value in (self.source_customer_id, self.customer_id)
            if value is not None
        ]
        if len(set(customer_ids)) > 1:
            raise ValueError("客户档案来源不能互相冲突")
        if self.service_contact is None and self.customer_name is None and not customer_ids:
            raise ValueError("必须填写联系人名称或从客户档案带入")
        if (
            self.service_contact is not None
            and self.customer_name is not None
            and self.service_contact.name != self.customer_name
        ):
            raise ValueError("联系人名称不能互相冲突")
        if self.cat_snapshot and len(self.cat_snapshot) != self.cat_count:
            raise ValueError("猫咪详情数量必须与猫咪数量一致")
        if (
            self.amount_adjustment.service_date is not None
            and self.amount_adjustment.service_date not in self.service_dates
        ):
            raise ValueError("金额变动日期必须属于订单服务日期")
        if (
            self.amount_adjustment.type is OrderAdjustmentType.DISCOUNT
            and self.amount_adjustment.amount > self.unit_price
        ):
            raise ValueError("减免后当日应收不能小于 0")
        return self


class OrderPatch(NormalizedOrderModel):
    source_customer_id: int | None = Field(default=None, gt=0)
    service_contact: OrderServiceContact | None = None
    cat_snapshot: list[OrderCatSnapshot] | None = Field(default=None, max_length=50)
    # 兼容旧客户端；不会按名称创建客户档案。
    customer_id: int | None = Field(default=None, gt=0)
    customer_name: str | None = Field(default=None, min_length=1, max_length=100)
    cat_count: int | None = Field(default=None, ge=1, le=50)
    service_dates: list[date] | None = Field(default=None, min_length=1, max_length=366)
    service_items: list[TaskItemType] | None = Field(default=None, min_length=1, max_length=8)
    unit_price: Decimal | None = Field(
        default=None, ge=0, max_digits=10, decimal_places=2
    )
    settlement_mode: OrderSettlementMode | None = None
    amount_adjustment: OrderAmountAdjustment | None = None
    notes: str | None = Field(default=None, max_length=4000)

    @field_validator("service_dates")
    @classmethod
    def normalize_service_dates(cls, values: list[date] | None) -> list[date] | None:
        return _normalized_service_dates(values) if values is not None else None

    @field_validator("service_items")
    @classmethod
    def normalize_service_items(
        cls, values: list[TaskItemType] | None
    ) -> list[TaskItemType] | None:
        return list(dict.fromkeys(values)) if values is not None else None

    @model_validator(mode="after")
    def reject_multiple_customer_references(self) -> Self:
        customer_ids = [
            value
            for value in (self.source_customer_id, self.customer_id)
            if value is not None
        ]
        if len(set(customer_ids)) > 1:
            raise ValueError("客户档案来源不能互相冲突")
        if (
            {"customer_id", "source_customer_id"} & self.model_fields_set
            and self.customer_id is None
            and self.source_customer_id is None
        ):
            # 显式清空来源档案是允许的；订单继续使用已有快照。
            return self
        if (
            self.service_contact is not None
            and self.customer_name is not None
            and self.service_contact.name != self.customer_name
        ):
            raise ValueError("联系人名称不能互相冲突")
        target_cat_count = self.cat_count
        if self.cat_snapshot is not None and target_cat_count is not None:
            if len(self.cat_snapshot) != target_cat_count:
                raise ValueError("猫咪详情数量必须与猫咪数量一致")
        return self


class OrderStatusUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    order_status: OrderStatus


class OrderCatSummary(BaseModel):
    id: int | None
    name: str
    is_active: bool


class OrderCustomerSummary(BaseModel):
    id: int | None
    name: str
    community: str | None
    address: str | None


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


class OrderServiceScheduleRead(BaseModel):
    service_date: date
    visit_count: int = Field(ge=1, le=10)


class OrderDailyReceivableRead(BaseModel):
    service_date: date
    expected_amount: Decimal = Field(ge=0)
    paid_amount: Decimal = Field(ge=0)
    due_amount: Decimal = Field(ge=0)
    task_status: TaskStatus | None


class OrderSummary(BaseModel):
    id: int
    source_customer_id: int | None
    service_contact: OrderServiceContact
    cat_snapshot: list[OrderCatSnapshot]
    customer: OrderCustomerSummary
    cats: list[OrderCatSummary]
    start_date: date
    end_date: date
    visits_per_day: int
    service_days: int
    total_visits: int
    cat_count: int = Field(ge=1, le=50)
    service_schedule: list[OrderServiceScheduleRead]
    service_items: list[TaskItemType]
    pricing_mode: Literal["legacy_components", "per_visit"]
    settlement_mode: OrderSettlementMode
    amount_adjustment: OrderAmountAdjustment
    unit_price: Decimal = Field(ge=0)
    base_price: Decimal
    extra_cat_fee: Decimal
    stairs_fee: Decimal
    other_fee: Decimal
    total_amount: Decimal
    paid_amount: Decimal
    due_amount: Decimal
    overpaid_amount: Decimal = Field(ge=0)
    payment_status: OrderPaymentStatus
    daily_receivables: list[OrderDailyReceivableRead]
    order_status: OrderStatus
    route_geocode_status: str | None
    pending_cat_profile_count: int = Field(ge=0)
    customer_resolution: str | None = None
    is_demo_data: bool = False
    task_count: int
    deletable: bool
    delete_block_reason: str | None
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
    photo_url: str | None
    gender: str | None
    age: Decimal | None
    breed: str | None
    personality: str | None
    food: str | None
    food_preference: str | None
    litter_type: str | None
    medication_required: bool
    medication_notes: str | None
    special_notes: str | None
    service_notes: str | None


class OrderCustomerOption(BaseModel):
    id: int
    name: str
    wechat_name: str | None
    phone: str | None
    community: str | None
    address: str | None
    building: str | None
    unit: str | None
    room: str | None
    access_method: str | None
    access_info: str | None
    key_status: str | None
    key_code: str | None
    notes: str | None
    is_repeat_customer: bool
    latitude: Decimal | None
    longitude: Decimal | None
    geocode_status: str | None
    cats: list[OrderCatOption]


class OrderFormOptions(BaseModel):
    customers: list[OrderCustomerOption]
    default_base_price: Decimal
    extra_cat_unit_price: Decimal
    stairs_unit_price: Decimal
