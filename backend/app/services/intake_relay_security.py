import hashlib
import hmac
import os
import threading
import time
from collections import defaultdict, deque

from fastapi import Header, HTTPException, Request
from fastapi.responses import JSONResponse


RELAY_KEY_ENV = "CATCARE_INTAKE_RELAY_KEY"
MAX_PUBLIC_BODY_BYTES = 256 * 1024
MAX_RATE_LIMIT_BUCKETS = 10_000
PRIVATE_RESPONSE_HEADERS = {
    "Cache-Control": "no-store",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
}


def require_relay_service(
    authorization: str | None = Header(default=None),
) -> None:
    expected = os.getenv(RELAY_KEY_ENV, "")
    if not expected:
        raise HTTPException(status_code=503, detail="云端中转管理凭据未配置")
    scheme, _, provided = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="云端中转管理凭据无效")


class IntakeRateLimiter:
    """Small per-instance guard; token/version checks remain the correctness layer."""

    def __init__(self, *, window_seconds: int = 60) -> None:
        self.window_seconds = window_seconds
        self._requests: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()
        self._last_sweep = time.monotonic()

    @staticmethod
    def _keys(request: Request) -> tuple[tuple[str, int], tuple[str, int]]:
        client = request.client.host if request.client else "unknown"
        path = request.url.path
        token_part = path.removeprefix("/api/fill/").split("/", 1)[0]
        token_hash = hashlib.sha256(token_part.encode("utf-8")).hexdigest()[:16]
        if request.method == "GET":
            ip_limit, token_limit = 120, 60
        else:
            ip_limit, token_limit = 60, 30
        return (
            (f"ip:{client}:{request.method}", ip_limit),
            (f"token:{token_hash}:{request.method}", token_limit),
        )

    def _sweep(self, *, now: float, cutoff: float) -> None:
        if (
            now - self._last_sweep < self.window_seconds
            and len(self._requests) < MAX_RATE_LIMIT_BUCKETS
        ):
            return
        empty_keys: list[str] = []
        for key, bucket in self._requests.items():
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if not bucket:
                empty_keys.append(key)
        for key in empty_keys:
            self._requests.pop(key, None)
        self._last_sweep = now

    def allow(self, request: Request) -> bool:
        now = time.monotonic()
        cutoff = now - self.window_seconds
        keys = self._keys(request)
        with self._lock:
            self._sweep(now=now, cutoff=cutoff)
            new_key_count = sum(key not in self._requests for key, _ in keys)
            if len(self._requests) + new_key_count > MAX_RATE_LIMIT_BUCKETS:
                return False
            for key, limit in keys:
                bucket = self._requests.get(key)
                if bucket:
                    while bucket and bucket[0] <= cutoff:
                        bucket.popleft()
                    if len(bucket) >= limit:
                        return False
            for key, _ in keys:
                self._requests[key].append(now)
            return True


def install_intake_relay_guards(app) -> None:
    limiter = IntakeRateLimiter()

    @app.middleware("http")
    async def protect_public_intake(request: Request, call_next):
        if request.url.path.startswith("/api/fill/"):
            content_length = request.headers.get("content-length")
            if content_length:
                try:
                    body_size = int(content_length)
                except ValueError:
                    return JSONResponse(
                        status_code=400,
                        content={"detail": "请求长度无效"},
                        headers=PRIVATE_RESPONSE_HEADERS,
                    )
                if body_size < 0 or body_size > MAX_PUBLIC_BODY_BYTES:
                    return JSONResponse(
                        status_code=413,
                        content={"detail": "提交内容过大"},
                        headers=PRIVATE_RESPONSE_HEADERS,
                    )
            if request.method in {"PUT", "POST", "PATCH"}:
                body = await request.body()
                if len(body) > MAX_PUBLIC_BODY_BYTES:
                    return JSONResponse(
                        status_code=413,
                        content={"detail": "提交内容过大"},
                        headers=PRIVATE_RESPONSE_HEADERS,
                    )
            if not limiter.allow(request):
                return JSONResponse(
                    status_code=429,
                    content={"detail": "操作过于频繁，请稍后重试"},
                    headers={**PRIVATE_RESPONSE_HEADERS, "Retry-After": "60"},
                )
        response = await call_next(request)
        if request.url.path.startswith(("/api/fill/", "/api/admin/intake")):
            response.headers.update(PRIVATE_RESPONSE_HEADERS)
        return response
