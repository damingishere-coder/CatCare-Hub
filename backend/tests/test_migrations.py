from alembic import command
from sqlalchemy import inspect

from app.db.session import build_engine
from tests.conftest import alembic_config


BUSINESS_TABLES = {
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
