from datetime import date, datetime, time, timezone
from decimal import Decimal

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.db.session import build_engine
from app.models import (
    Cat,
    Customer,
    CustomerFormSubmission,
    CustomerFormToken,
    FormSubmissionStatus,
    Order,
    OrderCat,
    OrderPaymentStatus,
    OrderStatus,
    Payment,
    PaymentMethod,
    PaymentRecordStatus,
    Task,
    TaskItem,
    TaskItemType,
    TaskPhoto,
    TaskStatus,
)
from app.services.credentials import token_digest


def test_core_entities_can_be_created_and_related(
    migrated_database_url: str,
) -> None:
    engine = build_engine(migrated_database_url)
    try:
        with Session(engine) as session:
            customer = Customer(
                name="单元测试虚构客户",
                community="虚构测试小区",
                address="不对应真实地址",
                latitude=Decimal("30.1234567"),
                longitude=Decimal("120.1234567"),
                geocode_status="resolved",
            )
            cat_one = Cat(name="测试猫一", age=Decimal("2.5"))
            cat_two = Cat(name="测试猫二", medication_required=True)
            customer.cats.extend([cat_one, cat_two])

            order = Order(
                customer=customer,
                start_date=date(2030, 1, 1),
                end_date=date(2030, 1, 2),
                visits_per_day=1,
                service_items=["feed", "water", "photo"],
                base_price=Decimal("30.00"),
                extra_cat_fee=Decimal("5.00"),
                total_amount=Decimal("70.00"),
                paid_amount=Decimal("70.00"),
                payment_status=OrderPaymentStatus.PAID,
                order_status=OrderStatus.CONFIRMED,
            )
            session.add(order)
            session.flush()
            assert order.order_number == 1
            order.cat_links.extend(
                [
                    OrderCat(order_id=order.id, cat_id=cat_one.id),
                    OrderCat(order_id=order.id, cat_id=cat_two.id),
                ]
            )

            task = Task(
                order=order,
                customer=customer,
                service_date=date(2030, 1, 1),
                planned_time=time(9, 30),
                sort_order=0,
                status=TaskStatus.CONFIRMED,
            )
            task.items.extend(
                [
                    TaskItem(item_type=TaskItemType.FEED),
                    TaskItem(item_type=TaskItemType.WATER),
                ]
            )
            task.photos.append(
                TaskPhoto(file_url="/uploads/tests/fictional-photo.jpg")
            )
            session.add(task)
            session.add(
                Payment(
                    order=order,
                    customer=customer,
                    amount=Decimal("70.00"),
                    payment_method=PaymentMethod.CASH,
                    payment_status=PaymentRecordStatus.COMPLETED,
                    paid_at=datetime(2030, 1, 1, 8, 0, tzinfo=timezone.utc),
                )
            )

            form_token = CustomerFormToken(
                token_hash=token_digest("unit-test-placeholder-value")
            )
            form_token.submissions.append(
                CustomerFormSubmission(
                    payload={"fixture": True},
                    status=FormSubmissionStatus.SUBMITTED,
                )
            )
            session.add(form_token)
            session.commit()

            persisted_order = session.scalar(
                select(Order)
                .options(
                    selectinload(Order.cat_links),
                    selectinload(Order.tasks).selectinload(Task.items),
                    selectinload(Order.tasks).selectinload(Task.photos),
                    selectinload(Order.payments),
                )
                .where(Order.id == order.id)
            )
            assert persisted_order is not None
            assert persisted_order.order_number == 1
            assert len(persisted_order.cat_links) == 2
            assert len(persisted_order.tasks) == 1
            assert len(persisted_order.tasks[0].items) == 2
            assert len(persisted_order.tasks[0].photos) == 1
            assert persisted_order.total_amount == Decimal("70.00")
            assert persisted_order.service_items == ["feed", "water", "photo"]
            assert len(persisted_order.payments) == 1
            assert session.scalar(select(func.count(CustomerFormSubmission.id))) == 1
    finally:
        engine.dispose()


@pytest.mark.parametrize(
    "invalid_order",
    [
        {"start_date": date(2030, 1, 2), "end_date": date(2030, 1, 1), "visits_per_day": 1},
        {"start_date": date(2030, 1, 1), "end_date": date(2030, 1, 2), "visits_per_day": 0},
    ],
)
def test_order_constraints_reject_invalid_values(
    migrated_database_url: str,
    invalid_order: dict[str, object],
) -> None:
    engine = build_engine(migrated_database_url)
    try:
        with Session(engine) as session:
            customer = Customer(name="约束测试虚构客户")
            session.add(customer)
            session.flush()
            session.add(
                Order(
                    customer_id=customer.id,
                    service_items=[],
                    **invalid_order,
                )
            )
            with pytest.raises(IntegrityError):
                session.commit()
    finally:
        engine.dispose()


def test_sqlite_foreign_keys_are_enforced(migrated_database_url: str) -> None:
    engine = build_engine(migrated_database_url)
    try:
        with Session(engine) as session:
            session.add(Cat(customer_id=999_999, name="无所属客户的虚构猫咪"))
            with pytest.raises(IntegrityError):
                session.commit()
    finally:
        engine.dispose()
