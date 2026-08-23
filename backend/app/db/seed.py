import argparse
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from app.db.session import build_engine
from app.models import (
    Cat,
    Customer,
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
    TaskStatus,
)


DEMO_MARKER = "[catcare-demo-seed-v1]"
DEMO_SYSTEM_KEY = "catcare-demo-seed-v1"


def seed_database(database_url: str | None = None) -> bool:
    """Insert one clearly fictional, atomic, and idempotent development dataset."""

    engine = build_engine(database_url)
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)

    try:
        with session_factory.begin() as session:
            if session.scalar(
                select(Customer.id).where(
                    (Customer.system_key == DEMO_SYSTEM_KEY)
                    | (Customer.notes == DEMO_MARKER)
                )
            ):
                return False

            _insert_demo_records(session)
        return True
    finally:
        engine.dispose()


def _insert_demo_records(session: Session) -> None:
    today = date.today()
    customer = Customer(
        name="演示客户（虚构）",
        system_key=DEMO_SYSTEM_KEY,
        wechat_name="演示账号（虚构）",
        community="虚构演示小区",
        address="仅用于开发演示，不对应任何真实地址",
        is_repeat_customer=False,
        notes=None,
    )
    cat_one = Cat(
        name="演示猫咪一号",
        breed="虚构品种",
        personality="开发测试用虚构档案",
    )
    cat_two = Cat(
        name="演示猫咪二号",
        breed="虚构品种",
        personality="开发测试用虚构档案",
    )
    customer.cats.extend([cat_one, cat_two])

    order = Order(
        customer=customer,
        contact_name=customer.name,
        contact_wechat_name=customer.wechat_name,
        contact_community=customer.community,
        contact_address=customer.address,
        contact_notes=customer.notes,
        cat_snapshot=[
            {"source_cat_id": cat_one.id, "name": cat_one.name},
            {"source_cat_id": cat_two.id, "name": cat_two.name},
        ],
        start_date=today,
        end_date=today + timedelta(days=2),
        visits_per_day=1,
        cat_count=2,
        service_items=["feed", "water", "litter", "photo"],
        base_price=Decimal("30.00"),
        extra_cat_fee=Decimal("5.00"),
        stairs_fee=Decimal("0.00"),
        other_fee=Decimal("0.00"),
        total_amount=Decimal("105.00"),
        paid_amount=Decimal("105.00"),
        payment_status=OrderPaymentStatus.PAID,
        order_status=OrderStatus.CONFIRMED,
        notes="仅用于开发测试的虚构订单",
    )
    session.add(order)
    session.flush()

    order.cat_links.extend(
        [
            OrderCat(order_id=order.id, cat_id=cat_one.id),
            OrderCat(order_id=order.id, cat_id=cat_two.id),
        ]
    )

    for day_offset in range(3):
        task = Task(
            order=order,
            customer=customer,
            service_date=today + timedelta(days=day_offset),
            planned_time=time(hour=9, minute=30),
            sort_order=day_offset,
            status=TaskStatus.CONFIRMED,
            notes="虚构演示任务",
        )
        task.items.extend(
            [
                TaskItem(item_type=TaskItemType.FEED),
                TaskItem(item_type=TaskItemType.WATER),
                TaskItem(item_type=TaskItemType.LITTER),
                TaskItem(item_type=TaskItemType.PHOTO),
            ]
        )
        session.add(task)

    session.add(
        Payment(
            order=order,
            customer=customer,
            amount=Decimal("105.00"),
            payment_method=PaymentMethod.WECHAT,
            payment_status=PaymentRecordStatus.COMPLETED,
            paid_at=datetime.now(timezone.utc),
            notes="虚构演示收款",
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="写入 CatCare-Hub 虚构开发 Seed 数据")
    parser.add_argument(
        "--database-url",
        help="可选数据库 URL；默认使用 CATCARE_DATABASE_URL 或 data/catcare.db",
    )
    args = parser.parse_args()

    try:
        created = seed_database(args.database_url)
    except OperationalError as error:
        raise SystemExit("Seed 失败：请先运行 migrate.bat 完成数据库迁移。") from error

    if created:
        print("已写入虚构开发 Seed 数据。")
    else:
        print("虚构开发 Seed 已存在，未重复写入。")


if __name__ == "__main__":
    main()
