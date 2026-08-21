"""Create the initial CatCare-Hub business schema.

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-08-22
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0001_initial_schema"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def timestamps() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    ]


def constrained_enum(*values: str, name: str, length: int) -> sa.Enum:
    return sa.Enum(
        *values,
        name=name,
        native_enum=False,
        create_constraint=False,
        length=length,
    )


def upgrade() -> None:
    op.create_table(
        "customers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("wechat_name", sa.String(length=100)),
        sa.Column("phone", sa.String(length=32)),
        sa.Column("community", sa.String(length=200)),
        sa.Column("address", sa.Text()),
        sa.Column("building", sa.String(length=50)),
        sa.Column("unit", sa.String(length=50)),
        sa.Column("room", sa.String(length=50)),
        sa.Column("access_method", sa.String(length=100)),
        sa.Column("access_info", sa.Text()),
        sa.Column("key_status", sa.String(length=50)),
        sa.Column("key_code", sa.String(length=100)),
        sa.Column("is_repeat_customer", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("notes", sa.Text()),
        sa.Column("latitude", sa.Numeric(10, 7)),
        sa.Column("longitude", sa.Numeric(10, 7)),
        sa.Column("geocode_status", sa.String(length=32)),
        *timestamps(),
        sa.CheckConstraint(
            "latitude IS NULL OR (latitude >= -90 AND latitude <= 90)",
            name="latitude_range",
        ),
        sa.CheckConstraint(
            "longitude IS NULL OR (longitude >= -180 AND longitude <= 180)",
            name="longitude_range",
        ),
    )
    op.create_index("ix_customers_name", "customers", ["name"])
    op.create_index("ix_customers_phone", "customers", ["phone"])
    op.create_index("ix_customers_community", "customers", ["community"])
    op.create_index("ix_customers_geocode_status", "customers", ["geocode_status"])

    op.create_table(
        "cats",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "customer_id",
            sa.Integer(),
            sa.ForeignKey("customers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("photo_url", sa.String(length=500)),
        sa.Column("gender", sa.String(length=32)),
        sa.Column("age", sa.Numeric(4, 1)),
        sa.Column("breed", sa.String(length=100)),
        sa.Column("personality", sa.Text()),
        sa.Column("food", sa.Text()),
        sa.Column("food_preference", sa.Text()),
        sa.Column("litter_type", sa.String(length=100)),
        sa.Column("medication_required", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("medication_notes", sa.Text()),
        sa.Column("special_notes", sa.Text()),
        sa.Column("service_notes", sa.Text()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="1"),
        *timestamps(),
        sa.CheckConstraint("age IS NULL OR age >= 0", name="age_non_negative"),
    )
    op.create_index("ix_cats_customer_id", "cats", ["customer_id"])
    op.create_index("ix_cats_customer_active", "cats", ["customer_id", "is_active"])

    op.create_table(
        "orders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "customer_id",
            sa.Integer(),
            sa.ForeignKey("customers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("visits_per_day", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("service_items", sa.JSON(), nullable=False),
        sa.Column("base_price", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("extra_cat_fee", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("stairs_fee", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("other_fee", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("total_amount", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("paid_amount", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column(
            "payment_status",
            constrained_enum(
                "unpaid", "partial", "paid", "refunded", name="order_payment_status", length=16
            ),
            nullable=False,
            server_default="unpaid",
        ),
        sa.Column(
            "order_status",
            constrained_enum(
                "pending_confirmation",
                "confirmed",
                "in_progress",
                "completed",
                "cancelled",
                name="order_status",
                length=24,
            ),
            nullable=False,
            server_default="pending_confirmation",
        ),
        sa.Column("notes", sa.Text()),
        *timestamps(),
        sa.CheckConstraint("end_date >= start_date", name="valid_date_range"),
        sa.CheckConstraint("visits_per_day > 0", name="visits_per_day_positive"),
        sa.CheckConstraint("base_price >= 0", name="base_price_non_negative"),
        sa.CheckConstraint("extra_cat_fee >= 0", name="extra_cat_fee_non_negative"),
        sa.CheckConstraint("stairs_fee >= 0", name="stairs_fee_non_negative"),
        sa.CheckConstraint("other_fee >= 0", name="other_fee_non_negative"),
        sa.CheckConstraint("total_amount >= 0", name="total_amount_non_negative"),
        sa.CheckConstraint("paid_amount >= 0", name="paid_amount_non_negative"),
        sa.CheckConstraint(
            "payment_status IN ('unpaid', 'partial', 'paid', 'refunded')",
            name="payment_status_values",
        ),
        sa.CheckConstraint(
            "order_status IN ('pending_confirmation', 'confirmed', 'in_progress', 'completed', 'cancelled')",
            name="order_status_values",
        ),
    )
    op.create_index("ix_orders_customer_id", "orders", ["customer_id"])
    op.create_index("ix_orders_start_date", "orders", ["start_date"])
    op.create_index("ix_orders_end_date", "orders", ["end_date"])
    op.create_index("ix_orders_payment_status", "orders", ["payment_status"])
    op.create_index("ix_orders_order_status", "orders", ["order_status"])
    op.create_index(
        "ix_orders_customer_dates", "orders", ["customer_id", "start_date", "end_date"]
    )

    op.create_table(
        "order_cats",
        sa.Column(
            "order_id",
            sa.Integer(),
            sa.ForeignKey("orders.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "cat_id",
            sa.Integer(),
            sa.ForeignKey("cats.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )

    op.create_table(
        "tasks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "order_id",
            sa.Integer(),
            sa.ForeignKey("orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "customer_id",
            sa.Integer(),
            sa.ForeignKey("customers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("service_date", sa.Date(), nullable=False),
        sa.Column("planned_time", sa.Time()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "status",
            constrained_enum(
                "pending",
                "confirmed",
                "ready",
                "in_progress",
                "completed",
                "exception",
                "cancelled",
                name="task_status",
                length=16,
            ),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("planned_lat", sa.Numeric(10, 7)),
        sa.Column("planned_lng", sa.Numeric(10, 7)),
        sa.Column("estimated_arrival", sa.DateTime(timezone=True)),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("notes", sa.Text()),
        *timestamps(),
        sa.CheckConstraint("sort_order >= 0", name="sort_order_non_negative"),
        sa.CheckConstraint(
            "status IN ('pending', 'confirmed', 'ready', 'in_progress', 'completed', 'exception', 'cancelled')",
            name="status_values",
        ),
        sa.CheckConstraint(
            "planned_lat IS NULL OR (planned_lat >= -90 AND planned_lat <= 90)",
            name="planned_lat_range",
        ),
        sa.CheckConstraint(
            "planned_lng IS NULL OR (planned_lng >= -180 AND planned_lng <= 180)",
            name="planned_lng_range",
        ),
    )
    op.create_index("ix_tasks_order_id", "tasks", ["order_id"])
    op.create_index("ix_tasks_customer_id", "tasks", ["customer_id"])
    op.create_index("ix_tasks_service_date", "tasks", ["service_date"])
    op.create_index("ix_tasks_status", "tasks", ["status"])
    op.create_index("ix_tasks_service_date_sort", "tasks", ["service_date", "sort_order"])
    op.create_index("ix_tasks_customer_date", "tasks", ["customer_id", "service_date"])

    op.create_table(
        "task_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "task_id",
            sa.Integer(),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "item_type",
            constrained_enum(
                "feed",
                "water",
                "litter",
                "canned_food",
                "medicine",
                "play",
                "photo",
                "other",
                name="task_item_type",
                length=16,
            ),
            nullable=False,
        ),
        sa.Column("required", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("completed", sa.Boolean(), nullable=False, server_default="0"),
        sa.CheckConstraint(
            "item_type IN ('feed', 'water', 'litter', 'canned_food', 'medicine', 'play', 'photo', 'other')",
            name="item_type_values",
        ),
    )
    op.create_index("ix_task_items_task_id", "task_items", ["task_id"])
    op.create_index("ix_task_items_task_type", "task_items", ["task_id", "item_type"])

    op.create_table(
        "task_photos",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "task_id",
            sa.Integer(),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("file_url", sa.String(length=500), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_task_photos_task_id", "task_photos", ["task_id"])

    op.create_table(
        "payments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "order_id",
            sa.Integer(),
            sa.ForeignKey("orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "customer_id",
            sa.Integer(),
            sa.ForeignKey("customers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column(
            "payment_method",
            constrained_enum(
                "wechat", "alipay", "cash", "other", name="payment_method", length=16
            ),
            nullable=False,
        ),
        sa.Column(
            "payment_status",
            constrained_enum(
                "pending",
                "completed",
                "refunded",
                name="payment_record_status",
                length=16,
            ),
            nullable=False,
            server_default="completed",
        ),
        sa.Column("paid_at", sa.DateTime(timezone=True)),
        sa.Column("notes", sa.Text()),
        *timestamps(),
        sa.CheckConstraint("amount > 0", name="amount_positive"),
        sa.CheckConstraint(
            "payment_method IN ('wechat', 'alipay', 'cash', 'other')",
            name="payment_method_values",
        ),
        sa.CheckConstraint(
            "payment_status IN ('pending', 'completed', 'refunded')",
            name="payment_status_values",
        ),
    )
    op.create_index("ix_payments_order_id", "payments", ["order_id"])
    op.create_index("ix_payments_customer_id", "payments", ["customer_id"])
    op.create_index("ix_payments_payment_status", "payments", ["payment_status"])
    op.create_index("ix_payments_paid_at", "payments", ["paid_at"])
    op.create_index(
        "ix_payments_customer_paid_at", "payments", ["customer_id", "paid_at"]
    )

    op.create_table(
        "customer_form_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("token", sa.String(length=128), nullable=False),
        sa.Column(
            "status",
            constrained_enum(
                "active", "disabled", "expired", name="form_token_status", length=16
            ),
            nullable=False,
            server_default="active",
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("submitted_at", sa.DateTime(timezone=True)),
        *timestamps(),
        sa.CheckConstraint(
            "status IN ('active', 'disabled', 'expired')",
            name="status_values",
        ),
    )
    op.create_index(
        "ix_customer_form_tokens_token", "customer_form_tokens", ["token"], unique=True
    )
    op.create_index(
        "ix_customer_form_tokens_status_expires",
        "customer_form_tokens",
        ["status", "expires_at"],
    )

    op.create_table(
        "customer_form_submissions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "token_id",
            sa.Integer(),
            sa.ForeignKey("customer_form_tokens.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column(
            "status",
            constrained_enum(
                "draft",
                "submitted",
                "reviewed",
                "converted",
                "expired",
                name="form_submission_status",
                length=16,
            ),
            nullable=False,
            server_default="draft",
        ),
        *timestamps(),
        sa.CheckConstraint(
            "status IN ('draft', 'submitted', 'reviewed', 'converted', 'expired')",
            name="status_values",
        ),
    )
    op.create_index(
        "ix_customer_form_submissions_token_id", "customer_form_submissions", ["token_id"]
    )
    op.create_index(
        "ix_customer_form_submissions_status", "customer_form_submissions", ["status"]
    )


def downgrade() -> None:
    op.drop_table("customer_form_submissions")
    op.drop_table("customer_form_tokens")
    op.drop_table("payments")
    op.drop_table("task_photos")
    op.drop_table("task_items")
    op.drop_table("tasks")
    op.drop_table("order_cats")
    op.drop_table("orders")
    op.drop_table("cats")
    op.drop_table("customers")
