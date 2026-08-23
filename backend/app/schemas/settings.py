from typing import Literal

from pydantic import BaseModel, ConfigDict


class IntegrationState(BaseModel):
    name: str
    configured: bool
    status: Literal["not_configured", "configured"]
    message: str | None


class IntegrationSettingsRead(BaseModel):
    amap_backend: IntegrationState
    gpt_recommendation: IntegrationState


class IntegrationTestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target: Literal["amap", "openai"]


class IntegrationTestResult(BaseModel):
    target: Literal["amap", "openai"]
    connected: bool
    message: str


class DemoDataCounts(BaseModel):
    customers: int
    cats: int
    orders: int
    tasks: int
    payments: int


class DemoDataPreview(BaseModel):
    system_key: Literal["catcare-demo-seed-v1"]
    already_cleared: bool
    counts: DemoDataCounts


class DemoDataClearRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    system_key: Literal["catcare-demo-seed-v1"]
    confirmation: Literal["永久清除演示数据"]


class DemoDataClearResult(DemoDataPreview):
    cleared: bool
