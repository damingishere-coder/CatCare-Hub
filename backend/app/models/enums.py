from enum import Enum
from typing import TypeVar

from sqlalchemy import Enum as SqlEnum


class OrderStatus(str, Enum):
    PENDING_CONFIRMATION = "pending_confirmation"
    CONFIRMED = "confirmed"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class OrderPaymentStatus(str, Enum):
    UNPAID = "unpaid"
    PARTIAL = "partial"
    PAID = "paid"
    REFUNDED = "refunded"


class OrderSettlementMode(str, Enum):
    DAILY = "daily"
    ORDER_TOTAL = "order_total"


class OrderAdjustmentType(str, Enum):
    NONE = "none"
    SURCHARGE = "surcharge"
    DISCOUNT = "discount"


class TaskStatus(str, Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    READY = "ready"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    EXCEPTION = "exception"
    CANCELLED = "cancelled"


class TaskItemType(str, Enum):
    FEED = "feed"
    WATER = "water"
    LITTER = "litter"
    CANNED_FOOD = "canned_food"
    MEDICINE = "medicine"
    PLAY = "play"
    PHOTO = "photo"
    OTHER = "other"


class PaymentMethod(str, Enum):
    WECHAT = "wechat"
    ALIPAY = "alipay"
    CASH = "cash"
    OTHER = "other"


class PaymentRecordStatus(str, Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    REFUNDED = "refunded"
    VOIDED = "voided"


class FormTokenStatus(str, Enum):
    ACTIVE = "active"
    DISABLED = "disabled"
    EXPIRED = "expired"


class FormSubmissionStatus(str, Enum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    REVIEWED = "reviewed"
    PROCESSING = "processing"
    ARCHIVED_CUSTOMER = "archived_customer"
    ARCHIVED_ORDER = "archived_order"
    VOIDED = "voided"
    REDACTED = "redacted"
    CONVERTED = "converted"
    EXPIRED = "expired"


EnumType = TypeVar("EnumType", bound=Enum)


def portable_enum(
    enum_class: type[EnumType],
    *,
    name: str,
    length: int,
) -> SqlEnum[EnumType]:
    """Persist stable enum values as constrained VARCHAR on SQLite/PostgreSQL."""

    return SqlEnum(
        enum_class,
        name=name,
        native_enum=False,
        create_constraint=False,
        validate_strings=True,
        values_callable=lambda items: [item.value for item in items],
        length=length,
    )
