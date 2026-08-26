"""Add route geocode provenance for trusted cached coordinates.

Revision ID: 0011_route_geocode_provenance
Revises: 0010_payment_void_audit
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0011_route_geocode_provenance"
down_revision: str | None = "0010_payment_void_audit"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _set_sqlite_foreign_keys(*, enabled: bool) -> None:
    connection = op.get_bind()
    if connection.dialect.name != "sqlite":
        return
    with op.get_context().autocommit_block():
        op.execute(sa.text(f"PRAGMA foreign_keys={'ON' if enabled else 'OFF'}"))


def upgrade() -> None:
    _set_sqlite_foreign_keys(enabled=False)
    with op.batch_alter_table("customers") as batch_op:
        batch_op.add_column(sa.Column("geocode_fingerprint", sa.String(length=64)))
        batch_op.add_column(sa.Column("geocode_adcode", sa.String(length=20)))
        batch_op.add_column(sa.Column("geocode_level", sa.String(length=32)))

    with op.batch_alter_table("orders") as batch_op:
        batch_op.add_column(sa.Column("route_geocode_fingerprint", sa.String(length=64)))
        batch_op.add_column(sa.Column("route_geocode_adcode", sa.String(length=20)))
        batch_op.add_column(sa.Column("route_geocode_level", sa.String(length=32)))
    _set_sqlite_foreign_keys(enabled=True)


def downgrade() -> None:
    _set_sqlite_foreign_keys(enabled=False)
    with op.batch_alter_table("orders") as batch_op:
        batch_op.drop_column("route_geocode_level")
        batch_op.drop_column("route_geocode_adcode")
        batch_op.drop_column("route_geocode_fingerprint")

    with op.batch_alter_table("customers") as batch_op:
        batch_op.drop_column("geocode_level")
        batch_op.drop_column("geocode_adcode")
        batch_op.drop_column("geocode_fingerprint")
    _set_sqlite_foreign_keys(enabled=True)
