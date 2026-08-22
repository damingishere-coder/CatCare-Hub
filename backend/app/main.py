from typing import Literal, TypedDict

from fastapi import FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.api.customers import router as customers_router
from app.api.dashboard import router as dashboard_router
from app.api.intake import router as intake_router
from app.api.mobile import router as mobile_router
from app.api.orders import router as orders_router
from app.api.payments import router as payments_router
from app.api.plans import router as plans_router
from app.api.tasks import router as tasks_router
from app.services.privacy_logging import install_fill_token_redaction


class HealthResponse(TypedDict):
    status: Literal["ok"]
    service: str


install_fill_token_redaction()


app = FastAPI(
    title="CatCare-Hub API",
    description="猫咪喂养登记系统本地 API",
    version="0.1.0",
)


@app.exception_handler(RequestValidationError)
async def privacy_safe_validation_error(
    request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    if not request.url.path.startswith("/api/fill/"):
        return await request_validation_exception_handler(request, exc)
    safe_errors = [
        {
            key: error[key]
            for key in ("type", "loc", "msg")
            if key in error
        }
        for error in exc.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": safe_errors})

app.include_router(customers_router)
app.include_router(dashboard_router)
app.include_router(intake_router)
app.include_router(mobile_router)
app.include_router(orders_router)
app.include_router(payments_router)
app.include_router(plans_router)
app.include_router(tasks_router)


@app.get("/api/health", response_model=HealthResponse, tags=["system"])
async def health_check() -> HealthResponse:
    """Return a small readiness response for local startup checks."""

    return {"status": "ok", "service": "catcare-hub-api"}
