import os
from collections.abc import Generator
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import Session, sessionmaker


PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env", override=False)
DEFAULT_DATABASE_PATH = PROJECT_ROOT / "data" / "catcare.db"
DATABASE_URL_ENV = "CATCARE_DATABASE_URL"


def get_database_url(database_url: str | None = None) -> str:
    """Resolve an explicit URL, environment override, or safe local default."""

    if database_url:
        return database_url

    environment_url = os.getenv(DATABASE_URL_ENV)
    if environment_url:
        return environment_url

    return f"sqlite:///{DEFAULT_DATABASE_PATH.as_posix()}"


def _prepare_sqlite_path(database_url: str) -> None:
    url = make_url(database_url)
    if url.get_backend_name() != "sqlite" or not url.database:
        return
    if url.database == ":memory:" or url.database.startswith("file:"):
        return

    Path(url.database).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)


def build_engine(database_url: str | None = None, **engine_options: Any) -> Engine:
    """Build an engine with SQLite foreign keys enabled and portable defaults."""

    resolved_url = get_database_url(database_url)
    url = make_url(resolved_url)
    options: dict[str, Any] = {"pool_pre_ping": True, **engine_options}

    if url.get_backend_name() == "sqlite":
        _prepare_sqlite_path(resolved_url)
        connect_args = dict(options.pop("connect_args", {}))
        connect_args.setdefault("check_same_thread", False)
        options["connect_args"] = connect_args

    engine = create_engine(resolved_url, **options)

    if url.get_backend_name() == "sqlite":

        @event.listens_for(engine, "connect")
        def enable_sqlite_foreign_keys(dbapi_connection: Any, _: Any) -> None:
            cursor = dbapi_connection.cursor()
            try:
                cursor.execute("PRAGMA foreign_keys=ON")
            finally:
                cursor.close()

    return engine


engine = build_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    """Yield a short-lived database session for future FastAPI dependencies."""

    with SessionLocal() as session:
        yield session
