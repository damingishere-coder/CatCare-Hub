from typing import Literal, TypedDict

from fastapi import Depends, FastAPI, Request, Response
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.customers import router as customers_router
from app.api.dashboard import router as dashboard_router
from app.api.intake import admin_router as admin_intake_router
from app.api.intake import public_router as public_intake_router
from app.api.mobile import router as mobile_router
from app.api.orders import router as orders_router
from app.api.payments import router as payments_router
from app.api.plans import router as plans_router
from app.api.settings import router as settings_router
from app.api.tasks import router as tasks_router
from app.db.session import engine
from app.services.readiness import database_readiness
from app.services.privacy_logging import install_fill_token_redaction
from app.services.local_access import allowed_hosts, require_local_request


class HealthResponse(TypedDict):
    status: Literal["ok"]
    service: str


class ReadyResponse(TypedDict):
    status: Literal["ready"]
    service: str
    database: Literal["ready"]
    schema_revision: str


install_fill_token_redaction()


app = FastAPI(
    title="CatCare-Hub API",
    description="猫咪喂养登记系统本地 API",
    version="0.1.0",
)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts())


@app.middleware("http")
async def add_sensitive_response_headers(request: Request, call_next) -> Response:
    response = await call_next(request)
    if request.url.path.startswith(
        ("/api/admin", "/api/mobile", "/api/fill")
    ):
        if "no-store" not in response.headers.get("Cache-Control", "").lower():
            response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
    return response


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

local_dependencies = [Depends(require_local_request)]

app.include_router(public_intake_router)
app.include_router(customers_router, dependencies=local_dependencies)
app.include_router(dashboard_router, dependencies=local_dependencies)
app.include_router(admin_intake_router, dependencies=local_dependencies)
app.include_router(mobile_router, dependencies=local_dependencies)
app.include_router(orders_router, dependencies=local_dependencies)
app.include_router(payments_router, dependencies=local_dependencies)
app.include_router(plans_router, dependencies=local_dependencies)
app.include_router(settings_router, dependencies=local_dependencies)
app.include_router(tasks_router, dependencies=local_dependencies)


@app.get("/api/health", response_model=HealthResponse, tags=["system"])
async def health_check() -> HealthResponse:
    """Return a small liveness response for compatibility checks."""

    return {"status": "ok", "service": "catcare-hub-api"}


@app.get("/api/ready", tags=["system"], response_model=None)
def ready_check() -> ReadyResponse | JSONResponse:
    """Report whether business APIs can safely use the current database."""

    readiness = database_readiness(engine)
    if not readiness.ready:
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "service": "catcare-hub-api",
                "reason": readiness.reason,
                "message": readiness.message,
            },
        )

    return {
        "status": "ready",
        "service": "catcare-hub-api",
        "database": "ready",
        "schema_revision": readiness.revision or "unknown",
    }
