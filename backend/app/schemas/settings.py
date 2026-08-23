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
