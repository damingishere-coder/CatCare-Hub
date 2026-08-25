import hashlib
from datetime import datetime, timezone

from alembic import command
import json

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.db.session import build_engine
from app.services.intake import load_public_token
from tests.conftest import alembic_config


BUSINESS_TABLES = {
    "cats",
    "customer_form_submissions",
    "customer_form_tokens",
    "customers",
    "order_cats",
    "order_service_dates",
    "orders",
    "payments",
    "system_flags",
    "task_items",
    "task_photos",
    "tasks",
}


def test_migration_creates_and_reverses_complete_schema(
    migrated_database_url: str,
) -> None:
    config = alembic_config(migrated_database_url)
    engine = build_engine(migrated_database_url)

    try:
        assert BUSINESS_TABLES | {"alembic_version"} == set(
            inspect(engine).get_table_names()
        )

        command.downgrade(config, "base")
        assert inspect(engine).get_table_names() == ["alembic_version"]

        command.upgrade(config, "head")
        assert BUSINESS_TABLES | {"alembic_version"} == set(
            inspect(engine).get_table_names()
        )
    finally:
        engine.dispose()


def test_migration_matches_sqlalchemy_metadata(migrated_database_url: str) -> None:
    command.check(alembic_config(migrated_database_url))


def test_intake_conversion_migration_adds_a_single_submission_contract(
    migrated_database_url: str,
) -> None:
    engine = build_engine(migrated_database_url)
    try:
        inspector = inspect(engine)
        columns = {
            column["name"]
            for column in inspector.get_columns("customer_form_submissions")
        }
        assert {
            "reviewed_at",
            "converted_at",
            "converted_customer_id",
            "converted_order_id",
        } <= columns
        unique_constraints = inspector.get_unique_constraints(
            "customer_form_submissions"
        )
        assert any(
            constraint["column_names"] == ["token_id"]
            for constraint in unique_constraints
        )
    finally:
        engine.dispose()


def test_security_migration_hashes_existing_intake_token(tmp_path) -> None:
    database_path = tmp_path / "p12-upgrade.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    config = alembic_config(database_url)
    command.upgrade(config, "0004_customer_intake_conversion")
    engine = build_engine(database_url)
    raw_token = "legacy_P10_token_value_that_remains_usable_123"
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO customer_form_tokens "
                    "(token, status, expires_at, created_at, updated_at) "
                    "VALUES (:token, 'active', '2035-01-01', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                ),
                {"token": raw_token},
            )
        command.upgrade(config, "head")
        columns = {
            column["name"]
            for column in inspect(engine).get_columns("customer_form_tokens")
        }
        assert "token" not in columns
        assert "token_hash" in columns
        with engine.connect() as connection:
            stored = connection.execute(
                text("SELECT token_hash FROM customer_form_tokens")
            ).scalar_one()
        assert stored == hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
        assert raw_token not in stored
        with Session(engine) as session:
            migrated_token = load_public_token(
                session,
                raw_token,
                now=datetime(2034, 1, 1, tzinfo=timezone.utc),
            )
            assert migrated_token.token_hash == stored
    finally:
        engine.dispose()


def test_local_no_auth_migration_removes_access_sessions(tmp_path) -> None:
    database_path = tmp_path / "local-no-auth-upgrade.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    config = alembic_config(database_url)
    command.upgrade(config, "0005_security_permissions")
    engine = build_engine(database_url)
    try:
        assert "access_sessions" in inspect(engine).get_table_names()
        command.upgrade(config, "head")
        assert "access_sessions" not in inspect(engine).get_table_names()
    finally:
        engine.dispose()


def test_p19_payment_void_migration_upgrades_and_downgrades_0009(tmp_path) -> None:
    database_path = tmp_path / "p19-from-0009.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    config = alembic_config(database_url)
    command.upgrade(config, "0009_order_daily_settlement")
    engine = build_engine(database_url)
    try:
        before_columns = {
            column["name"] for column in inspect(engine).get_columns("payments")
        }
        assert "voided_at" not in before_columns
        assert "voided_reason" not in before_columns

        command.upgrade(config, "0010_payment_void_audit")
        inspector = inspect(engine)
        after_columns = {
            column["name"] for column in inspector.get_columns("payments")
        }
        assert {"voided_at", "voided_reason"} <= after_columns
        checks = [
            constraint["sqltext"]
            for constraint in inspector.get_check_constraints("payments")
        ]
        assert any("voided" in check and "payment_status" in check for check in checks)
        assert any("voided_reason" in check for check in checks)
        with engine.connect() as connection:
            assert connection.execute(text("PRAGMA integrity_check")).scalar_one() == "ok"
            assert connection.execute(text("PRAGMA foreign_key_check")).all() == []

        command.downgrade(config, "0009_order_daily_settlement")
        downgraded_columns = {
            column["name"] for column in inspect(engine).get_columns("payments")
        }
        assert "voided_at" not in downgraded_columns
        assert "voided_reason" not in downgraded_columns
        command.upgrade(config, "head")
    finally:
        engine.dispose()


def test_p16_migration_upgrades_explicit_0007_database_and_preserves_history(
    tmp_path,
) -> None:
    database_path = tmp_path / "p16-from-0007.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    config = alembic_config(database_url)
    command.upgrade(config, "0007_simplify_customer_orders")
    engine = build_engine(database_url)
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO customers "
                    "(id, name, phone, community, address, unit, room, access_info, "
                    "created_at, updated_at) VALUES "
                    "(1, 'P16 迁移客户（虚构）', 'P16-FAKE-PHONE', 'P16 虚构小区', "
                    "'P16 虚构路 16 号', '3 单元', '1601', '虚构入户说明', "
                    "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO cats "
                    "(id, customer_id, name, medication_required, is_active, "
                    "service_notes, created_at, updated_at) VALUES "
                    "(1, 1, 'P16 迁移猫（虚构）', 0, 1, '迁移照护说明', "
                    "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO orders "
                    "(id, customer_id, start_date, end_date, visits_per_day, cat_count, "
                    "service_items, pricing_mode, base_price, extra_cat_fee, stairs_fee, "
                    "other_fee, total_amount, paid_amount, payment_status, order_status, "
                    "created_at, updated_at) VALUES "
                    "(1, 1, '2036-02-01', '2036-02-01', 1, 1, '[\"feed\",\"photo\"]', "
                    "'per_visit', 66, 0, 0, 0, 66, 20, 'partial', 'confirmed', "
                    "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )
            connection.execute(
                text("INSERT INTO order_cats (order_id, cat_id) VALUES (1, 1)")
            )
            connection.execute(
                text(
                    "INSERT INTO order_service_dates "
                    "(order_id, service_date, visit_count) VALUES (1, '2036-02-01', 1)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO tasks "
                    "(id, order_id, customer_id, service_date, sort_order, status, "
                    "created_at, updated_at) VALUES "
                    "(1, 1, 1, '2036-02-01', 0, 'completed', "
                    "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO task_items "
                    "(id, task_id, item_type, required, completed) "
                    "VALUES (1, 1, 'feed', 1, 1)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO payments "
                    "(id, order_id, customer_id, amount, payment_method, payment_status, "
                    "paid_at, created_at, updated_at) VALUES "
                    "(1, 1, 1, 20, 'wechat', 'completed', CURRENT_TIMESTAMP, "
                    "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )

        command.upgrade(config, "head")
        with engine.connect() as connection:
            order = connection.execute(
                text(
                    "SELECT contact_name, contact_phone, contact_address, contact_unit, "
                    "contact_room, contact_access_info, cat_snapshot FROM orders WHERE id = 1"
                )
            ).one()
            counts = connection.execute(
                text(
                    "SELECT (SELECT COUNT(*) FROM orders), "
                    "(SELECT COUNT(*) FROM tasks), "
                    "(SELECT COUNT(*) FROM task_items), "
                    "(SELECT COUNT(*) FROM payments), "
                    "(SELECT COUNT(*) FROM order_service_dates)"
                )
            ).one()
            p18_compatibility = connection.execute(
                text(
                    "SELECT orders.settlement_mode, orders.adjustment_type, "
                    "orders.adjustment_amount, payments.service_date "
                    "FROM orders JOIN payments ON payments.order_id = orders.id "
                    "WHERE orders.id = 1"
                )
            ).one()
        assert tuple(order[:6]) == (
            "P16 迁移客户（虚构）",
            "P16-FAKE-PHONE",
            "P16 虚构路 16 号",
            "3 单元",
            "1601",
            "虚构入户说明",
        )
        snapshot = json.loads(order[6]) if isinstance(order[6], str) else order[6]
        assert snapshot[0]["name"] == "P16 迁移猫（虚构）"
        assert snapshot[0]["service_notes"] == "迁移照护说明"
        assert tuple(counts) == (1, 1, 1, 1, 1)
        assert tuple(p18_compatibility) == ("order_total", "none", 0, None)

        with engine.begin() as connection:
            connection.execute(text("DELETE FROM customers WHERE id = 1"))
        with engine.connect() as connection:
            preserved = connection.execute(
                text(
                    "SELECT orders.customer_id, tasks.customer_id, payments.customer_id, "
                    "orders.contact_name, "
                    "(SELECT COUNT(*) FROM tasks), (SELECT COUNT(*) FROM payments) "
                    "FROM orders JOIN tasks ON tasks.order_id = orders.id "
                    "JOIN payments ON payments.order_id = orders.id WHERE orders.id = 1"
                )
            ).one()
        assert tuple(preserved) == (
            None,
            None,
            None,
            "P16 迁移客户（虚构）",
            1,
            1,
        )
    finally:
        engine.dispose()


def test_p15_migration_backfills_schedule_cat_count_and_internal_seed_marker(
    tmp_path,
) -> None:
    database_path = tmp_path / "p15-upgrade.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    config = alembic_config(database_url)
    command.upgrade(config, "0006_remove_access_sessions")
    engine = build_engine(database_url)
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO customers (id, name, phone, community, address, notes, created_at, updated_at) "
                    "VALUES (1, '迁移虚构客户', 'MIGRATION-FAKE-PHONE', '迁移虚构小区', "
                    "'迁移虚构路 1 号', '[catcare-demo-seed-v1]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO cats (id, customer_id, name, medication_required, is_active, created_at, updated_at) "
                    "VALUES (1, 1, '迁移猫甲', 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP), "
                    "(2, 1, '迁移猫乙', 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO orders (id, customer_id, start_date, end_date, visits_per_day, service_items, "
                    "base_price, extra_cat_fee, stairs_fee, other_fee, total_amount, paid_amount, payment_status, "
                    "order_status, created_at, updated_at) VALUES "
                    "(1, 1, '2033-01-02', '2033-01-04', 2, '[\"feed\"]', 30, 5, 0, 0, 210, 0, "
                    "'unpaid', 'confirmed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )
            connection.execute(
                text("INSERT INTO order_cats (order_id, cat_id) VALUES (1, 1), (1, 2)")
            )
            connection.execute(
                text(
                    "INSERT INTO tasks (id, order_id, customer_id, service_date, sort_order, status, "
                    "created_at, updated_at) VALUES "
                    "(1, 1, 1, '2033-01-02', 0, 'completed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO task_items (id, task_id, item_type, required, completed) "
                    "VALUES (1, 1, 'feed', 1, 1)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO task_photos (id, task_id, file_url, created_at) "
                    "VALUES (1, 1, '/uploads/migration-fake.png', CURRENT_TIMESTAMP)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO payments (id, order_id, customer_id, amount, payment_method, "
                    "payment_status, paid_at, created_at, updated_at) VALUES "
                    "(1, 1, 1, 20, 'wechat', 'completed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )

        command.upgrade(config, "head")
        with engine.connect() as connection:
            customer = connection.execute(
                text("SELECT system_key, notes FROM customers WHERE id = 1")
            ).one()
            order = connection.execute(
                text(
                    "SELECT cat_count, pricing_mode, contact_name, contact_phone, "
                    "contact_community, contact_address, cat_snapshot FROM orders WHERE id = 1"
                )
            ).one()
            schedule = connection.execute(
                text(
                    "SELECT service_date, visit_count FROM order_service_dates "
                    "WHERE order_id = 1 ORDER BY service_date"
                )
            ).all()
            history_counts = connection.execute(
                text(
                    "SELECT "
                    "(SELECT COUNT(*) FROM tasks), "
                    "(SELECT COUNT(*) FROM task_items), "
                    "(SELECT COUNT(*) FROM task_photos), "
                    "(SELECT COUNT(*) FROM payments), "
                    "(SELECT COUNT(*) FROM order_cats)"
                )
            ).one()
        assert tuple(customer) == ("catcare-demo-seed-v1", None)
        assert tuple(order[:6]) == (
            2,
            "legacy_components",
            "迁移虚构客户",
            "MIGRATION-FAKE-PHONE",
            "迁移虚构小区",
            "迁移虚构路 1 号",
        )
        cat_snapshot = json.loads(order[6]) if isinstance(order[6], str) else order[6]
        assert [cat["name"] for cat in cat_snapshot] == ["迁移猫甲", "迁移猫乙"]
        assert tuple(history_counts) == (1, 1, 1, 1, 2)
        assert [(str(day), count) for day, count in schedule] == [
            ("2033-01-02", 2),
            ("2033-01-03", 2),
            ("2033-01-04", 2),
        ]

        command.downgrade(config, "0006_remove_access_sessions")
        assert "order_service_dates" not in inspect(engine).get_table_names()
        with engine.connect() as connection:
            restored_notes = connection.execute(
                text("SELECT notes FROM customers WHERE id = 1")
            ).scalar_one()
        assert restored_notes == "[catcare-demo-seed-v1]"
    finally:
        engine.dispose()
