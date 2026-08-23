from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Literal

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, inspect, text
from sqlalchemy.exc import SQLAlchemyError


PROJECT_ROOT = Path(__file__).resolve().parents[3]
ALEMBIC_CONFIG_PATH = PROJECT_ROOT / "backend" / "alembic.ini"

ReadinessReason = Literal[
    "ready",
    "database_unavailable",
    "schema_outdated",
    "schema_check_failed",
]


@dataclass(frozen=True)
class DatabaseReadiness:
    ready: bool
    reason: ReadinessReason
    message: str
    revision: str | None = None


@lru_cache(maxsize=4)
def expected_schema_heads(
    config_path: str = str(ALEMBIC_CONFIG_PATH),
) -> frozenset[str]:
    """Return the repository's Alembic heads without opening the database."""

    config = Config(config_path)
    scripts = ScriptDirectory.from_config(config)
    return frozenset(scripts.get_heads())


def database_readiness(
    database_engine: Engine,
    *,
    expected_heads: frozenset[str] | None = None,
) -> DatabaseReadiness:
    """Check connectivity and the exact Alembic revision without leaking DB details."""

    try:
        heads = expected_heads if expected_heads is not None else expected_schema_heads()
    except Exception:
        return DatabaseReadiness(
            ready=False,
            reason="schema_check_failed",
            message="服务版本检查失败，请查看后端日志。",
        )

    if not heads:
        return DatabaseReadiness(
            ready=False,
            reason="schema_check_failed",
            message="服务没有可用的数据库版本信息，请查看后端日志。",
        )

    try:
        with database_engine.connect() as connection:
            connection.execute(text("SELECT 1")).scalar_one()
            if not inspect(connection).has_table("alembic_version"):
                return DatabaseReadiness(
                    ready=False,
                    reason="schema_outdated",
                    message="数据库尚未迁移到当前版本，请运行 migrate.bat。",
                )
            revisions = frozenset(
                connection.execute(text("SELECT version_num FROM alembic_version"))
                .scalars()
                .all()
            )
    except SQLAlchemyError:
        return DatabaseReadiness(
            ready=False,
            reason="database_unavailable",
            message="数据库暂时不可用，请检查本机数据库文件。",
        )

    if revisions != heads:
        current_revision = ",".join(sorted(revisions)) or None
        return DatabaseReadiness(
            ready=False,
            reason="schema_outdated",
            message="数据库版本与当前程序不一致，请运行 migrate.bat。",
            revision=current_revision,
        )

    return DatabaseReadiness(
        ready=True,
        reason="ready",
        message="数据库已就绪。",
        revision=",".join(sorted(revisions)),
    )
