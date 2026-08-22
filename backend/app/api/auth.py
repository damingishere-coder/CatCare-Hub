from fastapi import APIRouter, HTTPException, Request, Response, status

from app.schemas.auth import LoginRequest, SessionRead
from app.services.auth import (
    CurrentAccessSession,
    DatabaseSession,
    SESSION_COOKIE_NAME,
    configured_password_hash,
    cookie_secure,
    create_access_session,
    delete_expired_sessions,
    enforce_browser_origin,
    login_rate_limiter,
    revoke_session,
    revoke_raw_session,
    session_hours,
)
from app.services.credentials import parse_password_hash, verify_access_code


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=SessionRead)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    session: DatabaseSession,
) -> SessionRead:
    enforce_browser_origin(request)
    retry_after = login_rate_limiter.check(request, payload.role)
    if retry_after is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="登录尝试过多，请稍后再试",
            headers={"Retry-After": str(retry_after)},
        )

    password_hash = configured_password_hash(payload.role)
    try:
        if password_hash is None:
            raise ValueError
        parse_password_hash(password_hash)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="本地访问码尚未配置，请先运行 setup.bat",
        )
    if not verify_access_code(payload.access_code, password_hash):
        login_rate_limiter.fail(request, payload.role)
        raise HTTPException(status_code=401, detail="角色或访问码错误")

    login_rate_limiter.success(request, payload.role)
    delete_expired_sessions(session)
    revoke_raw_session(session, request.cookies.get(SESSION_COOKIE_NAME))
    raw_token, access_session = create_access_session(
        session,
        payload.role,
        credential_hash=password_hash,
    )
    session.commit()
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=raw_token,
        max_age=session_hours() * 60 * 60,
        expires=access_session.expires_at,
        path="/",
        secure=cookie_secure(),
        httponly=True,
        samesite="strict",
    )
    return SessionRead(role=payload.role, expires_at=access_session.expires_at)


@router.get("/session", response_model=SessionRead)
def read_session(access_session: CurrentAccessSession) -> SessionRead:
    return SessionRead(
        role=access_session.role,
        expires_at=access_session.expires_at,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    response: Response,
    session: DatabaseSession,
    access_session: CurrentAccessSession,
) -> None:
    enforce_browser_origin(request)
    revoke_session(session, access_session)
    response.delete_cookie(
        SESSION_COOKIE_NAME,
        path="/",
        secure=cookie_secure(),
        httponly=True,
        samesite="strict",
    )
