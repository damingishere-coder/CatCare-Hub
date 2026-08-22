from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


AccessRole = Literal["admin", "mobile"]


class LoginRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    role: AccessRole
    access_code: str = Field(min_length=12, max_length=256)


class SessionRead(BaseModel):
    role: AccessRole
    expires_at: datetime
