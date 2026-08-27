import asyncio
import os
from contextlib import asynccontextmanager
from typing import Literal, TypedDict

from fastapi import Depends, FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.intake import public_router, relay_admin_router
from app.db.session import SessionLocal, engine
from app.services.intake_redaction_worker import run_redaction_worker
from app.services.intake_relay_security import (
    install_intake_relay_guards,
    require_relay_service,
)
from app.services.privacy_logging import install_fill_token_redaction
from app.services.readiness import database_readiness


class RelayHealth(TypedDict):
    status: Literal["ok"]
    service: str


def _csv_env(name: str, default: str) -> list[str]:
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


@asynccontextmanager
async def relay_lifespan(_: FastAPI):
    cleanup_task = None
    if os.getenv("CATCARE_RELAY_BACKGROUND_CLEANUP") == "1":
        cleanup_task = asyncio.create_task(run_redaction_worker(SessionLocal))
    try:
        yield
    finally:
        if cleanup_task is not None:
            cleanup_task.cancel()
            try:
                await cleanup_task
            except asyncio.CancelledError:
                pass


def create_relay_app() -> FastAPI:
    relay = FastAPI(
        title="CatCare-Hub Customer Intake Relay",
        description="Only public customer intake and protected relay synchronization APIs.",
        version="0.1.0",
        lifespan=relay_lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    relay.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=_csv_env(
            "CATCARE_RELAY_ALLOWED_HOSTS",
            "localhost,127.0.0.1,testserver",
        ),
    )
    public_origins = _csv_env("CATCARE_PUBLIC_FILL_ORIGIN", "")
    if public_origins:
        relay.add_middleware(
            CORSMiddleware,
            allow_origins=public_origins,
            allow_credentials=False,
            allow_methods=["GET", "PUT", "POST", "OPTIONS"],
            allow_headers=["Content-Type"],
            max_age=600,
        )
    install_intake_relay_guards(relay)

    @relay.exception_handler(RequestValidationError)
    async def privacy_safe_validation_error(
        request: Request,
        exc: RequestValidationError,
    ) -> JSONResponse:
        if not request.url.path.startswith("/api/fill/"):
            return await request_validation_exception_handler(request, exc)
        safe_errors = [
            {key: error[key] for key in ("type", "loc", "msg") if key in error}
            for error in exc.errors()
        ]
        return JSONResponse(status_code=422, content={"detail": safe_errors})

    relay.include_router(public_router)
    relay.include_router(
        relay_admin_router,
        dependencies=[Depends(require_relay_service)],
    )

    @relay.get("/api/health", response_model=RelayHealth, tags=["system"])
    def health() -> RelayHealth:
        return {"status": "ok", "service": "catcare-intake-relay"}

    @relay.get("/api/ready", tags=["system"], response_model=None)
    def ready():
        readiness = database_readiness(engine)
        if not readiness.ready:
            return JSONResponse(
                status_code=503,
                content={
                    "status": "not_ready",
                    "service": "catcare-intake-relay",
                    "reason": readiness.reason,
                    "message": readiness.message,
                },
            )
        return {
            "status": "ready",
            "service": "catcare-intake-relay",
            "database": "ready",
            "schema_revision": readiness.revision or "unknown",
        }

    return relay


install_fill_token_redaction()
app = create_relay_app()
