from pathlib import Path
import sqlite3

from alembic import command
from alembic.config import Config
from sqlalchemy.pool import NullPool

import pytest

import app.db.preflight as preflight_module
from app.db.preflight import DatabasePreparationError, ensure_database_ready
from app.db.session import build_engine
from app.services.readiness import ALEMBIC_CONFIG_PATH, database_readiness


def alembic_config(database_url: str) -> Config:
    config = Config(str(ALEMBIC_CONFIG_PATH))
    config.set_main_option("sqlalchemy.url", database_url)
    return config


def test_preflight_backs_up_and_upgrades_outdated_sqlite(tmp_path: Path) -> None:
    database_path = tmp_path / "outdated.db"
    backup_dir = tmp_path / "backups"
    database_url = f"sqlite:///{database_path.as_posix()}"
    command.upgrade(
        alembic_config(database_url),
        "0007_simplify_customer_orders",
    )

    result = ensure_database_ready(database_url, backup_dir=backup_dir)

    assert result.migrated is True
    assert result.backup_path is not None
    assert result.backup_path.exists()
    assert result.backup_path.parent == backup_dir
    database_engine = build_engine(database_url, poolclass=NullPool)
    try:
        assert database_readiness(database_engine).ready is True
    finally:
        database_engine.dispose()


def test_preflight_does_not_touch_current_sqlite(
    migrated_database_url: str,
    tmp_path: Path,
) -> None:
    result = ensure_database_ready(
        migrated_database_url,
        backup_dir=tmp_path / "backups",
    )

    assert result.migrated is False
    assert result.backup_path is None
    assert not (tmp_path / "backups").exists()


def test_preflight_refuses_to_auto_migrate_non_sqlite(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        preflight_module,
        "_readiness_for",
        lambda _url: preflight_module.DatabaseReadiness(
            ready=False,
            reason="schema_outdated",
            message="数据库版本与当前程序不一致。",
        ),
    )

    with pytest.raises(DatabasePreparationError, match="非本机 SQLite"):
        ensure_database_ready("postgresql://example.invalid/catcare")


def test_preflight_keeps_backup_and_stops_when_upgrade_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database_path = tmp_path / "migration-fails.db"
    backup_dir = tmp_path / "backups"
    database_url = f"sqlite:///{database_path.as_posix()}"
    command.upgrade(
        alembic_config(database_url),
        "0007_simplify_customer_orders",
    )

    def fail_upgrade(*_args, **_kwargs) -> None:
        raise RuntimeError("synthetic failure")

    monkeypatch.setattr(preflight_module, "_upgrade_database", fail_upgrade)

    with pytest.raises(DatabasePreparationError, match="备份位于"):
        ensure_database_ready(database_url, backup_dir=backup_dir)

    backups = list(backup_dir.glob("*.db"))
    assert len(backups) == 1
    assert backups[0].stat().st_size > 0


def test_preflight_stops_when_sqlite_foreign_key_check_fails(tmp_path: Path) -> None:
    database_path = tmp_path / "broken-foreign-key.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    command.upgrade(alembic_config(database_url), "head")
    with sqlite3.connect(database_path) as connection:
        connection.execute("PRAGMA foreign_keys=OFF")
        connection.execute(
            "INSERT INTO tasks (order_id, service_date, sort_order, status) "
            "VALUES (999999, '2039-01-01', 0, 'pending')"
        )
        connection.commit()

    with pytest.raises(DatabasePreparationError, match="完整性或外键"):
        ensure_database_ready(database_url, backup_dir=tmp_path / "backups")

    assert not (tmp_path / "backups").exists()
