from datetime import datetime
from decimal import Decimal
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class NormalizedModel(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    @field_validator("*", mode="before")
    @classmethod
    def normalize_strings(cls, value: object) -> object:
        if isinstance(value, str):
            normalized = value.strip()
            return normalized or None
        return value


class CustomerFields(NormalizedModel):
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


class CustomerCreate(CustomerFields):
    name: str = Field(min_length=1, max_length=100)


class CustomerUpdate(NormalizedModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
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
    is_repeat_customer: bool | None = None

    @model_validator(mode="after")
    def reject_null_required_fields(self) -> Self:
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("客户姓名不能为空")
        if "is_repeat_customer" in self.model_fields_set and self.is_repeat_customer is None:
            raise ValueError("老客户状态不能为空")
        return self


class CatFields(NormalizedModel):
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


class CatCreate(CatFields):
    name: str = Field(min_length=1, max_length=100)


class CatUpdate(NormalizedModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    photo_url: str | None = Field(default=None, max_length=500)
    gender: str | None = Field(default=None, max_length=32)
    age: Decimal | None = Field(default=None, ge=0, le=999)
    breed: str | None = Field(default=None, max_length=100)
    personality: str | None = Field(default=None, max_length=4000)
    food: str | None = Field(default=None, max_length=4000)
    food_preference: str | None = Field(default=None, max_length=4000)
    litter_type: str | None = Field(default=None, max_length=100)
    medication_required: bool | None = None
    medication_notes: str | None = Field(default=None, max_length=4000)
    special_notes: str | None = Field(default=None, max_length=4000)
    service_notes: str | None = Field(default=None, max_length=4000)
    is_active: bool | None = None

    @model_validator(mode="after")
    def reject_null_required_fields(self) -> Self:
        for field in ("name", "medication_required", "is_active"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} 不能为空")
        return self


class CatRead(CatFields):
    model_config = ConfigDict(from_attributes=True)

    id: int
    customer_id: int
    name: str
    is_active: bool
    created_at: datetime
    updated_at: datetime


class CustomerSummary(BaseModel):
    id: int
    name: str
    wechat_name: str | None
    phone: str | None
    community: str | None
    is_repeat_customer: bool
    active_cat_count: int
    inactive_cat_count: int
    updated_at: datetime


class CustomerDetail(CustomerFields):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    cats: list[CatRead]
    created_at: datetime
    updated_at: datetime


class CustomerListResponse(BaseModel):
    items: list[CustomerSummary]
    total: int


class CustomerSearch(NormalizedModel):
    search: str = Field(min_length=1, max_length=100)
