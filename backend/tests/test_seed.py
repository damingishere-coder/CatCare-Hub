from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.seed import DEMO_SYSTEM_KEY, seed_database
from app.db.session import build_engine
from app.models import (
    Cat,
    Customer,
    CustomerFormToken,
    Order,
    Payment,
    Task,
    TaskPhoto,
)


def test_development_seed_is_safe_and_idempotent(
    migrated_database_url: str,
) -> None:
    assert seed_database(migrated_database_url) is True
    assert seed_database(migrated_database_url) is False

    engine = build_engine(migrated_database_url)
    try:
        with Session(engine) as session:
            customer = session.scalar(select(Customer).where(Customer.system_key == DEMO_SYSTEM_KEY))
            assert customer is not None
            assert customer.notes is None
            assert customer.phone is None
            assert customer.access_info is None
            assert customer.key_code is None

            assert session.scalar(select(func.count(Customer.id))) == 1
            assert session.scalar(select(func.count(Cat.id))) == 2
            assert session.scalar(select(func.count(Order.id))) == 1
            assert session.scalar(select(func.count(Task.id))) == 3
            assert session.scalar(select(func.count(Payment.id))) == 1
            assert session.scalar(select(func.count(CustomerFormToken.id))) == 0
            assert session.scalar(select(func.count(TaskPhoto.id))) == 0
    finally:
        engine.dispose()
