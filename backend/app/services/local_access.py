import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import HTTPException, Request


PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env", override=False)


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


def require_local_request(request: Request) -> None:
    """Reject cross-site writes while leaving local read requests password-free."""

    if request.method.upper() in {"GET", "HEAD", "OPTIONS"}:
        return
    if request.headers.get("sec-fetch-site", "").lower() == "cross-site":
        raise HTTPException(status_code=403, detail="拒绝跨站请求")
    origin = request.headers.get("origin")
    if origin and origin.rstrip("/") not in trusted_origins():
        raise HTTPException(status_code=403, detail="请求来源不受信任")
