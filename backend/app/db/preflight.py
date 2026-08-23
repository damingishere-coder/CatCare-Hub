from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import make_url
from sqlalchemy.pool import NullPool

from app.db.session import PROJECT_ROOT, build_engine, get_database_url
from app.services.readiness import (
    ALEMBIC_CONFIG_PATH,
    DatabaseReadiness,
    database_readiness,
)


DEFAULT_BACKUP_DIR = PROJECT_ROOT / "data" / "backups"


class DatabasePreparationError(RuntimeError):
    """Raised when startup cannot safely make the database ready."""


@dataclass(frozen=True)
class DatabasePreparation:
    migrated: bool
    backup_path: Path | None
    readiness: DatabaseReadiness


def _sqlite_database_path(database_url: str) -> Path | None:
    url = make_url(database_url)
    if url.get_backend_name() != "sqlite" or not url.database:
        return None
    if url.database == ":memory:" or url.database.startswith("file:"):
        return None
    return Path(url.database).expanduser().resolve()


def _backup_sqlite(database_path: Path, backup_dir: Path) -> Path | None:
    if not database_path.exists() or database_path.stat().st_size == 0:
        return None

    backup_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    backup_path = backup_dir / f"{database_path.stem}-before-migrate-{timestamp}.db"

    source_uri = f"file:{database_path.as_posix()}?mode=ro"
    with sqlite3.connect(source_uri, uri=True) as source:
        with sqlite3.connect(backup_path) as destination:
            source.backup(destination)
    return backup_path


def _upgrade_database(database_url: str, config_path: Path) -> None:
    config = Config(str(config_path))
    config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    command.upgrade(config, "head")


def _readiness_for(database_url: str) -> DatabaseReadiness:
    try:
        database_engine = build_engine(database_url, poolclass=NullPool)
    except Exception:
        return DatabaseReadiness(
            ready=False,
            reason="database_unavailable",
            message="数据库暂时不可用，请检查数据库配置。",
        )
    try:
        return database_readiness(database_engine)
    finally:
        database_engine.dispose()


def ensure_database_ready(
    database_url: str | None = None,
    *,
    backup_dir: Path = DEFAULT_BACKUP_DIR,
    config_path: Path = ALEMBIC_CONFIG_PATH,
) -> DatabasePreparation:
    """Prepare the local SQLite DB for startup, refusing unsafe external migration."""

    resolved_url = get_database_url(database_url)
    initial = _readiness_for(resolved_url)
    if initial.ready:
        return DatabasePreparation(False, None, initial)
    if initial.reason != "schema_outdated":
        raise DatabasePreparationError(initial.message)

    sqlite_path = _sqlite_database_path(resolved_url)
    if sqlite_path is None:
        raise DatabasePreparationError(
            "检测到非本机 SQLite 数据库且版本不一致；为避免误迁移，请人工运行 migrate.bat。"
        )

    try:
        backup_path = _backup_sqlite(sqlite_path, backup_dir)
    except sqlite3.Error as exc:
        raise DatabasePreparationError("数据库迁移前备份失败，启动已停止。") from exc

    try:
        _upgrade_database(resolved_url, config_path)
    except Exception as exc:
        location = f"；备份位于 {backup_path}" if backup_path else ""
        raise DatabasePreparationError(f"数据库迁移失败，启动已停止{location}。") from exc

    final = _readiness_for(resolved_url)
    if not final.ready:
        location = f"；备份位于 {backup_path}" if backup_path else ""
        raise DatabasePreparationError(f"数据库迁移后仍未就绪{location}。")

    return DatabasePreparation(True, backup_path, final)
