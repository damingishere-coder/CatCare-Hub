import os
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, cast

from dotenv import load_dotenv
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.auth import AccessSession
from app.schemas.auth import AccessRole
from app.services.business_time import as_utc
from app.services.credentials import token_digest


PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env", override=False)

SESSION_TOKEN_BYTES = 32
SESSION_COOKIE_NAME = "catcare_session"
DEFAULT_SESSION_HOURS = 12
MAX_SESSION_HOURS = 24 * 30
LOGIN_FAILURE_LIMIT = 5
LOGIN_FAILURE_WINDOW_SECONDS = 5 * 60

DatabaseSession = Annotated[Session, Depends(get_db)]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def configured_password_hash(role: AccessRole) -> str | None:
    name = (
        "CATCARE_ADMIN_PASSWORD_HASH"
        if role == "admin"
        else "CATCARE_MOBILE_PASSWORD_HASH"
    )
    value = os.getenv(name, "").strip()
    return value or None


def session_hours() -> int:
    raw_value = os.getenv("CATCARE_SESSION_HOURS", str(DEFAULT_SESSION_HOURS)).strip()
    try:
        value = int(raw_value)
    except ValueError as exc:
        raise RuntimeError("CATCARE_SESSION_HOURS 必须是整数") from exc
    if not 1 <= value <= MAX_SESSION_HOURS:
        raise RuntimeError(f"CATCARE_SESSION_HOURS 必须在 1 到 {MAX_SESSION_HOURS} 之间")
    return value


def cookie_secure() -> bool:
    raw_value = os.getenv("CATCARE_COOKIE_SECURE", "false").strip().lower()
    if raw_value not in {"true", "false"}:
        raise RuntimeError("CATCARE_COOKIE_SECURE 只能是 true 或 false")
    return raw_value == "true"


def allowed_hosts() -> list[str]:
    raw_value = os.getenv(
        "CATCARE_ALLOWED_HOSTS", "localhost,127.0.0.1,testserver"
    )
    hosts = [host.strip() for host in raw_value.split(",") if host.strip()]
    return hosts or ["localhost", "127.0.0.1", "testserver"]


def trusted_origins() -> set[str]:
    raw_value = os.getenv(
        "CATCARE_TRUSTED_ORIGINS", "http://localhost:5180,http://127.0.0.1:5180"
    )
    return {
        origin.strip().rstrip("/")
        for origin in raw_value.split(",")
        if origin.strip()
    }


def enforce_browser_origin(request: Request) -> None:
    if request.method.upper() in {"GET", "HEAD", "OPTIONS"}:
        return
    if request.headers.get("sec-fetch-site", "").lower() == "cross-site":
        raise HTTPException(status_code=403, detail="拒绝跨站请求")
    origin = request.headers.get("origin")
    if not origin:
        return
    if origin.rstrip("/") not in trusted_origins():
        raise HTTPException(status_code=403, detail="请求来源不受信任")


def create_access_session(
    session: Session,
    role: AccessRole,
    *,
    credential_hash: str,
    now: datetime | None = None,
) -> tuple[str, AccessSession]:
    created_at = now or utc_now()
    raw_token = secrets.token_urlsafe(SESSION_TOKEN_BYTES)
    access_session = AccessSession(
        token_hash=token_digest(raw_token),
        role=role,
        credential_fingerprint=token_digest(credential_hash),
        expires_at=created_at + timedelta(hours=session_hours()),
    )
    session.add(access_session)
    session.flush()
    return raw_token, access_session


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="请先登录",
        headers={"WWW-Authenticate": "Session"},
    )


def get_current_session(
    request: Request,
    session: DatabaseSession,
) -> AccessSession:
    raw_token = request.cookies.get(SESSION_COOKIE_NAME)
    if not raw_token:
        raise _unauthorized()
    access_session = session.scalar(
        select(AccessSession).where(AccessSession.token_hash == token_digest(raw_token))
    )
    if access_session is None:
        raise _unauthorized()
    current_password_hash = configured_password_hash(
        cast(AccessRole, access_session.role)
    )
    if not current_password_hash or not secrets.compare_digest(
        access_session.credential_fingerprint,
        token_digest(current_password_hash),
    ):
        session.delete(access_session)
        session.commit()
        raise _unauthorized()
    expires_at = as_utc(access_session.expires_at)
    if expires_at is None or expires_at <= utc_now():
        session.delete(access_session)
        session.commit()
        raise _unauthorized()
    return access_session


CurrentAccessSession = Annotated[AccessSession, Depends(get_current_session)]


def require_admin(
    request: Request,
    access_session: CurrentAccessSession,
) -> AccessSession:
    enforce_browser_origin(request)
    if access_session.role != "admin":
        raise HTTPException(status_code=403, detail="当前执行端账号无后台权限")
    return access_session


def require_mobile(
    request: Request,
    access_session: CurrentAccessSession,
) -> AccessSession:
    enforce_browser_origin(request)
    if access_session.role not in {"admin", "mobile"}:
        raise HTTPException(status_code=403, detail="当前账号无执行端权限")
    return access_session


def revoke_session(session: Session, access_session: AccessSession) -> None:
    session.delete(access_session)
    session.commit()


def revoke_raw_session(session: Session, raw_token: str | None) -> None:
    if raw_token:
        session.execute(
            delete(AccessSession).where(
                AccessSession.token_hash == token_digest(raw_token)
            )
        )


def delete_expired_sessions(
    session: Session,
    *,
    now: datetime | None = None,
) -> None:
    session.execute(
        delete(AccessSession).where(AccessSession.expires_at <= (now or utc_now()))
    )


class LoginRateLimiter:
    def __init__(self) -> None:
        self._failures: dict[tuple[str, str], deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _key(self, request: Request, role: AccessRole) -> tuple[str, str]:
        client_host = request.client.host if request.client else "unknown"
        return client_host, role

    def check(self, request: Request, role: AccessRole) -> int | None:
        now = time.monotonic()
        key = self._key(request, role)
        with self._lock:
            attempts = self._failures[key]
            while attempts and now - attempts[0] >= LOGIN_FAILURE_WINDOW_SECONDS:
                attempts.popleft()
            if len(attempts) < LOGIN_FAILURE_LIMIT:
                return None
            return max(1, int(LOGIN_FAILURE_WINDOW_SECONDS - (now - attempts[0])))

    def fail(self, request: Request, role: AccessRole) -> None:
        with self._lock:
            self._failures[self._key(request, role)].append(time.monotonic())

    def success(self, request: Request, role: AccessRole) -> None:
        with self._lock:
            self._failures.pop(self._key(request, role), None)

    def reset(self) -> None:
        with self._lock:
            self._failures.clear()


login_rate_limiter = LoginRateLimiter()
