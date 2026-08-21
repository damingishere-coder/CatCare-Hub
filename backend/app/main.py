from typing import Literal, TypedDict

from fastapi import FastAPI

from app.api.customers import router as customers_router
from app.api.dashboard import router as dashboard_router
from app.api.orders import router as orders_router
from app.api.plans import router as plans_router
from app.api.tasks import router as tasks_router


class HealthResponse(TypedDict):
    status: Literal["ok"]
    service: str


app = FastAPI(
    title="CatCare-Hub API",
    description="猫咪喂养登记系统本地 API",
    version="0.1.0",
)

app.include_router(customers_router)
app.include_router(dashboard_router)
app.include_router(orders_router)
app.include_router(plans_router)
app.include_router(tasks_router)


@app.get("/api/health", response_model=HealthResponse, tags=["system"])
async def health_check() -> HealthResponse:
    """Return a small readiness response for local startup checks."""

    return {"status": "ok", "service": "catcare-hub-api"}
