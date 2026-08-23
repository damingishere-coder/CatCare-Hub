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


class IntakeCustomerSubmit(IntakeCustomerDraft):
    name: str = Field(min_length=1, max_length=100)
    address: str = Field(min_length=1, max_length=1000)


class IntakeCatSubmit(IntakeCatDraft):
    name: str = Field(min_length=1, max_length=100)


class IntakeServiceSubmit(IntakeServiceDraft):
    start_date: date
    end_date: date
    visits_per_day: int = Field(ge=1, le=10)
    service_items: list[TaskItemType] = Field(min_length=1, max_length=8)


class IntakeSubmissionPayload(IntakeModel):
    customer: IntakeCustomerSubmit
    cats: list[IntakeCatSubmit] = Field(min_length=1, max_length=20)
    service: IntakeServiceSubmit
    notes: str | None = Field(default=None, max_length=4000)


PublicIntakeState = Literal["editable", "submitted", "reviewed", "converted"]


class PublicIntakeRead(BaseModel):
    status: PublicIntakeState
    expires_at: datetime
    draft: IntakeDraftPayload | None = None


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


class IntakeSubmissionDetail(IntakeSubmissionSummary):
    payload: IntakeDraftPayload
    review_payload: IntakeSubmissionPayload | None
    review_unit_price: Decimal | None
    reviewed_at: datetime | None
    converted_at: datetime | None
    converted_customer_id: int | None
    converted_order_id: int | None


class IntakeConversionRead(BaseModel):
    submission_id: int
    status: FormSubmissionStatus
    customer_id: int
    order_id: int
    revision: str


class IntakeReviewDraftUpdate(RevisionCommand):
    review_payload: IntakeSubmissionPayload
    unit_price: Decimal = Field(ge=0, max_digits=10, decimal_places=2)
