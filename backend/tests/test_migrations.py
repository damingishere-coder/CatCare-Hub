import hashlib
from datetime import datetime, timezone

from alembic import command
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.db.session import build_engine
from app.services.intake import load_public_token
from tests.conftest import alembic_config


BUSINESS_TABLES = {
    "access_sessions",
    "cats",
    "customer_form_submissions",
    "customer_form_tokens",
    "customers",
    "order_cats",
    "orders",
    "payments",
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
