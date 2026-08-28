from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.enums import FormSubmissionStatus, FormTokenStatus, TaskItemType


class IntakeModel(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    @field_validator("*", mode="before")
    @classmethod
    def normalize_strings(cls, value: object) -> object:
        if isinstance(value, str):
            normalized = value.strip()
            return normalized or None
        return value


class IntakeCustomerDraft(IntakeModel):
    name: str | None = Field(default=None, max_length=100)
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


class IntakeCatDraft(IntakeModel):
    name: str | None = Field(default=None, max_length=100)
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


class IntakeServiceDraft(IntakeModel):
    start_date: date | None = None
    end_date: date | None = None
    visits_per_day: int | None = Field(default=None, ge=1, le=10)
    service_items: list[TaskItemType] = Field(default_factory=list, max_length=8)

    @field_validator("service_items")
    @classmethod
    def deduplicate_service_items(
        cls,
        service_items: list[TaskItemType],
    ) -> list[TaskItemType]:
        return list(dict.fromkeys(service_items))

    @model_validator(mode="after")
    def validate_optional_date_range(self) -> Self:
        if self.start_date and self.end_date:
            if self.end_date < self.start_date:
                raise ValueError("结束日期不能早于开始日期")
            if (self.end_date - self.start_date).days + 1 > 366:
                raise ValueError("服务日期范围不能超过 366 天")
        return self


class IntakeDraftPayload(IntakeModel):
    customer: IntakeCustomerDraft = Field(default_factory=IntakeCustomerDraft)
    cats: list[IntakeCatDraft] = Field(default_factory=list, max_length=20)
    service: IntakeServiceDraft = Field(default_factory=IntakeServiceDraft)
    notes: str | None = Field(default=None, max_length=4000)


PublicAccessMethod = Literal[
    "无",
    "密码",
    "门卡",
    "钥匙开门",
    "指纹或人脸",
    "联系物业或门卫",
]


class PublicIntakeCustomerDraft(IntakeModel):
    name: str | None = Field(default=None, max_length=100)
    wechat_name: str | None = Field(default=None, max_length=100)
    phone: str | None = Field(default=None, max_length=32)
    address: str | None = Field(default=None, max_length=1000)
    access_method: str | None = Field(default=None, max_length=100)
    community_access_method: PublicAccessMethod | None = None
    building_access_method: PublicAccessMethod | None = None
    key_status: str | None = Field(default=None, max_length=50)
    notes: str | None = Field(default=None, max_length=4000)


class PublicIntakeCatDraft(IntakeModel):
    name: str | None = Field(default=None, max_length=100)
    food: str | None = Field(default=None, max_length=4000)
    litter_type: str | None = Field(default=None, max_length=100)
    medication_required: bool = False
    medication_notes: str | None = Field(default=None, max_length=4000)
    special_notes: str | None = Field(default=None, max_length=4000)


class PublicIntakeServiceDraft(IntakeModel):
    start_date: date | None = None
    end_date: date | None = None
    visits_per_day: int | None = Field(default=None, ge=1, le=10)

    @model_validator(mode="after")
    def validate_optional_date_range(self) -> Self:
        if self.start_date and self.end_date:
            if self.end_date < self.start_date:
                raise ValueError("结束日期不能早于开始日期")
            if (self.end_date - self.start_date).days + 1 > 366:
                raise ValueError("服务日期范围不能超过 366 天")
        return self


class PublicIntakeDraftPayload(IntakeModel):
    customer: PublicIntakeCustomerDraft = Field(
        default_factory=PublicIntakeCustomerDraft
    )
    cats: list[PublicIntakeCatDraft] = Field(default_factory=list, max_length=20)
    service: PublicIntakeServiceDraft = Field(
        default_factory=PublicIntakeServiceDraft
    )
    notes: str | None = Field(default=None, max_length=4000)


class PublicIntakeSubmissionPayload(PublicIntakeDraftPayload):
    @model_validator(mode="after")
    def validate_minimum_customer_information(self) -> Self:
        if not self.customer.name:
            raise ValueError("请填写客户姓名或称呼")
        if not self.customer.phone and not self.customer.wechat_name:
            raise ValueError("手机号和微信至少填写一项")
        return self


class IntakeCustomerSubmit(IntakeCustomerDraft):
    name: str = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def validate_contact_method(self) -> Self:
        if not self.phone and not self.wechat_name:
            raise ValueError("手机号和微信至少填写一项")
        return self


class IntakeCatArchive(IntakeCatDraft):
    name: str = Field(min_length=1, max_length=100)


class IntakeOrderCustomer(IntakeCustomerSubmit):
    address: str = Field(min_length=1, max_length=1000)


class IntakeServiceArchive(IntakeServiceDraft):
    start_date: date
    end_date: date
    visits_per_day: int = Field(ge=1, le=10)
    service_items: list[TaskItemType] = Field(min_length=1, max_length=8)


class IntakeSubmissionPayload(IntakeModel):
    customer: IntakeCustomerSubmit
    cats: list[IntakeCatDraft] = Field(default_factory=list, max_length=20)
    service: IntakeServiceDraft = Field(default_factory=IntakeServiceDraft)
    notes: str | None = Field(default=None, max_length=4000)


class IntakeOrderArchivePayload(IntakeModel):
    customer: IntakeOrderCustomer
    cats: list[IntakeCatArchive] = Field(min_length=1, max_length=20)
    service: IntakeServiceArchive
    notes: str | None = Field(default=None, max_length=4000)


PublicIntakeState = Literal[
    "editable",
    "submitted",
    "reviewed",
    "archived",
    "voided",
]


class PublicIntakeRead(BaseModel):
    status: PublicIntakeState
    expires_at: datetime
    draft: PublicIntakeDraftPayload | None = None
    revision: str | None = None


class PublicDraftUpdate(IntakeModel):
    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")
    draft: PublicIntakeDraftPayload


class PublicSubmitCommand(IntakeModel):
    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")
    idempotency_key: str = Field(min_length=16, max_length=128)
    payload: PublicIntakeSubmissionPayload


class TokenCreate(IntakeModel):
    expires_in_days: int = Field(default=14, ge=1, le=90)


class RevisionCommand(IntakeModel):
    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")


class TokenStatusUpdate(RevisionCommand):
    status: Literal[FormTokenStatus.ACTIVE, FormTokenStatus.DISABLED]


class IntakeTokenRead(BaseModel):
    id: int
    status: FormTokenStatus
    expires_at: datetime | None
    submitted_at: datetime | None
    fill_path: str | None
    submission_status: FormSubmissionStatus | None
    revision: str
    created_at: datetime


class IntakeTokenList(BaseModel):
    items: list[IntakeTokenRead]
    total: int


class IntakeSubmissionSummary(BaseModel):
    id: int
    submission_uuid: str
    status: FormSubmissionStatus
    customer_name: str | None
    community: str | None
    cat_count: int
    start_date: date | None
    end_date: date | None
    submitted_at: datetime | None
    updated_at: datetime
    revision: str


class IntakeSubmissionList(BaseModel):
    items: list[IntakeSubmissionSummary]
    total: int


class IntakeAuditEventRead(BaseModel):
    id: int
    event_type: str
    actor: str
    revision_number: int | None
    decision_mode: Literal["customer", "order", "void"] | None
    details: dict[str, int | str | bool | None]
    created_at: datetime


class IntakeSubmissionDetail(IntakeSubmissionSummary):
    payload: IntakeDraftPayload
    review_payload: IntakeDraftPayload | None
    review_unit_price: Decimal | None
    reviewed_at: datetime | None
    converted_at: datetime | None
    voided_at: datetime | None
    purge_after: datetime | None
    redacted_at: datetime | None
    decision_mode: Literal["customer", "order", "void"] | None
    decision_idempotency_key: str | None
    converted_customer_id: int | None
    converted_order_id: int | None
    audit_events: list[IntakeAuditEventRead] = Field(default_factory=list)


class IntakeConversionRead(BaseModel):
    submission_id: int
    status: FormSubmissionStatus
    customer_id: int
    order_id: int | None
    revision: str


class IntakeReviewDraftUpdate(RevisionCommand):
    review_payload: IntakeDraftPayload
    unit_price: Decimal | None = Field(
        default=None,
        ge=0,
        max_digits=10,
        decimal_places=2,
    )


class IntakeDecisionCommand(RevisionCommand):
    idempotency_key: str = Field(min_length=16, max_length=128)


class IntakeDecisionRead(BaseModel):
    submission_id: int
    submission_uuid: str
    status: FormSubmissionStatus
    decision_mode: Literal["customer", "order", "void"]
    customer_id: int | None
    order_id: int | None
    revision: str


class IntakeClaimCommand(IntakeDecisionCommand):
    decision_mode: Literal["customer", "order", "void"]


class IntakeClaimRead(BaseModel):
    submission_id: int
    submission_uuid: str
    status: FormSubmissionStatus
    decision_mode: Literal["customer", "order", "void"]
    claim_token: str | None
    revision: str


class IntakeCompleteCommand(IntakeModel):
    claim_token: str = Field(min_length=32, max_length=128)
    idempotency_key: str = Field(min_length=16, max_length=128)
    decision_mode: Literal["customer", "order", "void"]
    customer_id: int | None = Field(default=None, ge=1)
    order_id: int | None = Field(default=None, ge=1)


class IntakeRedactionRead(BaseModel):
    redacted_count: int = Field(ge=0)
