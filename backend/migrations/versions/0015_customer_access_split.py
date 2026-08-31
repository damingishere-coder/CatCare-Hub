"""Split community and building access methods while preserving legacy values.

Revision ID: 0015_customer_access_split
Revises: 0014_consistency_guards
"""

from collections.abc import Sequence
import re

from alembic import op
import sqlalchemy as sa


revision: str = "0015_customer_access_split"
down_revision: str | None = "0014_consistency_guards"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ACCESS_PATTERN = re.compile(
    r"^小区门禁：(?P<community>[^；]+)；楼下门禁：(?P<building>[^；]+)$"
)


def _set_sqlite_foreign_keys(*, enabled: bool) -> None:
    connection = op.get_bind()
    if connection.dialect.name != "sqlite":
        return
    with op.get_context().autocommit_block():
        op.execute(sa.text(f"PRAGMA foreign_keys={'ON' if enabled else 'OFF'}"))


def _split(value: str | None) -> tuple[str | None, str | None] | None:
    if not value:
        return None
    match = ACCESS_PATTERN.fullmatch(value)
    if match is None:
        return None
    community = match.group("community")
    building = match.group("building")
    return (
        None if community == "待确认" else community,
        None if building == "待确认" else building,
    )


def _backfill_split_fields() -> None:
    connection = op.get_bind()
    customer_rows = connection.execute(
        sa.text("SELECT id, access_method FROM customers WHERE access_method IS NOT NULL")
    ).mappings().all()
    for row in customer_rows:
        parsed = _split(row["access_method"])
        if parsed is None:
            continue
        connection.execute(
            sa.text(
                "UPDATE customers SET access_method = NULL, "
                "community_access_method = :community, "
                "building_access_method = :building WHERE id = :id"
            ),
            {"id": row["id"], "community": parsed[0], "building": parsed[1]},
        )

    order_rows = connection.execute(
        sa.text(
            "SELECT id, contact_access_method FROM orders "
            "WHERE contact_access_method IS NOT NULL"
        )
    ).mappings().all()
    for row in order_rows:
        parsed = _split(row["contact_access_method"])
        if parsed is None:
            continue
        connection.execute(
            sa.text(
                "UPDATE orders SET contact_access_method = NULL, "
                "contact_community_access_method = :community, "
                "contact_building_access_method = :building WHERE id = :id"
            ),
            {"id": row["id"], "community": parsed[0], "building": parsed[1]},
        )


def _merge_for_downgrade(
    *,
    legacy: str | None,
    community: str | None,
    building: str | None,
) -> str | None:
    if legacy:
        if community is not None or building is not None:
            raise RuntimeError("历史门禁与已分类门禁同时存在，无法无损降级到 0014")
        return legacy
    if community is None and building is None:
        return None
    merged = f"小区门禁：{community or '待确认'}；楼下门禁：{building or '待确认'}"
    if len(merged) > 100:
        raise RuntimeError("门禁字段合并后超过 100 字符，无法无损降级到 0014")
    return merged


def _restore_legacy_fields() -> None:
    connection = op.get_bind()
    customer_rows = connection.execute(
        sa.text(
            "SELECT id, access_method, community_access_method, "
            "building_access_method FROM customers"
        )
    ).mappings().all()
    for row in customer_rows:
        merged = _merge_for_downgrade(
            legacy=row["access_method"],
            community=row["community_access_method"],
            building=row["building_access_method"],
        )
        connection.execute(
            sa.text("UPDATE customers SET access_method = :value WHERE id = :id"),
            {"id": row["id"], "value": merged},
        )

    order_rows = connection.execute(
        sa.text(
            "SELECT id, contact_access_method, contact_community_access_method, "
            "contact_building_access_method FROM orders"
        )
    ).mappings().all()
    for row in order_rows:
        merged = _merge_for_downgrade(
            legacy=row["contact_access_method"],
            community=row["contact_community_access_method"],
            building=row["contact_building_access_method"],
        )
        connection.execute(
            sa.text("UPDATE orders SET contact_access_method = :value WHERE id = :id"),
            {"id": row["id"], "value": merged},
        )


def upgrade() -> None:
    _set_sqlite_foreign_keys(enabled=False)
    with op.batch_alter_table("customers") as batch_op:
        batch_op.add_column(sa.Column("community_access_method", sa.String(length=100)))
        batch_op.add_column(sa.Column("building_access_method", sa.String(length=100)))
    with op.batch_alter_table("orders") as batch_op:
        batch_op.add_column(
            sa.Column("contact_community_access_method", sa.String(length=100))
        )
        batch_op.add_column(
            sa.Column("contact_building_access_method", sa.String(length=100))
        )
    _set_sqlite_foreign_keys(enabled=True)
    _backfill_split_fields()


def downgrade() -> None:
    _restore_legacy_fields()
    _set_sqlite_foreign_keys(enabled=False)
    with op.batch_alter_table("orders") as batch_op:
        batch_op.drop_column("contact_building_access_method")
        batch_op.drop_column("contact_community_access_method")
    with op.batch_alter_table("customers") as batch_op:
        batch_op.drop_column("building_access_method")
        batch_op.drop_column("community_access_method")
    _set_sqlite_foreign_keys(enabled=True)
