from typing import Literal, TypedDict

from fastapi import FastAPI


class HealthResponse(TypedDict):
    status: Literal["ok"]
    service: str


app = FastAPI(
    title="CatCare-Hub API",
    description="猫咪喂养登记系统本地 API",
    version="0.1.0",
)


@app.get("/api/health", response_model=HealthResponse, tags=["system"])
async def health_check() -> HealthResponse:
    """Return a small readiness response for local startup checks."""

    return {"status": "ok", "service": "catcare-hub-api"}
