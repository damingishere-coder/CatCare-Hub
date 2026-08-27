import os

from alembic import command
from alembic.config import Config
from sqlalchemy import make_url, text

from app.db.session import build_engine, get_database_url
from app.services.readiness import ALEMBIC_CONFIG_PATH, database_readiness


RELAY_SERVER_ENV = "CATCARE_INTAKE_RELAY_SERVER"
RELAY_AUTO_MIGRATE_ENV = "CATCARE_RELAY_AUTO_MIGRATE"
RELAY_MIGRATION_LOCK = 0x4341544341524522


class RelayDatabasePreparationError(RuntimeError):
    pass


def _upgrade(database_url: str) -> None:
    config = Config(str(ALEMBIC_CONFIG_PATH))
    config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    command.upgrade(config, "head")


def prepare_relay_database() -> None:
    """Prepare only the dedicated relay PostgreSQL database under an advisory lock."""

    if os.getenv(RELAY_SERVER_ENV) != "1":
        raise RelayDatabasePreparationError("拒绝在非中转服务进程中准备云端数据库")
    database_url = get_database_url()
    if make_url(database_url).get_backend_name() != "postgresql":
        raise RelayDatabasePreparationError("云端中转服务只允许使用独立 PostgreSQL 数据库")

    engine = build_engine(database_url)
    try:
        if os.getenv(RELAY_AUTO_MIGRATE_ENV) == "1":
            with engine.connect() as connection:
                connection.execute(
                    text("SELECT pg_advisory_lock(:lock_key)"),
                    {"lock_key": RELAY_MIGRATION_LOCK},
                )
                try:
                    _upgrade(database_url)
                finally:
                    connection.execute(
                        text("SELECT pg_advisory_unlock(:lock_key)"),
                        {"lock_key": RELAY_MIGRATION_LOCK},
                    )

        readiness = database_readiness(engine)
        if not readiness.ready:
            raise RelayDatabasePreparationError(
                "云端中转数据库尚未迁移到当前版本"
            )
    finally:
        engine.dispose()
