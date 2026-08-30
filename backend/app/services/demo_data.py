from fastapi import HTTPException
from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.models.customer import Cat, Customer
from app.models.order import Order, OrderCat
from app.models.payment import Payment
from app.models.system import SystemFlag
from app.models.task import Task, TaskItem, TaskPhoto
from app.schemas.settings import DemoDataCounts


DEMO_SYSTEM_KEY = "catcare-demo-seed-v1"
DEMO_CLEARED_FLAG = "demo-data-cleared:catcare-demo-seed-v1"


def demo_data_counts(session: Session) -> DemoDataCounts:
    customer = session.scalar(
        select(Customer).where(
            Customer.system_key == DEMO_SYSTEM_KEY,
            Customer.seed_source == DEMO_SYSTEM_KEY,
        )
    )
    if customer is None:
        return DemoDataCounts(customers=0, cats=0, orders=0, tasks=0, payments=0)
    order_ids = list(
        session.scalars(
            select(Order.id).where(
                Order.customer_id == customer.id,
                Order.seed_source == DEMO_SYSTEM_KEY,
            )
        )
    )
    return DemoDataCounts(
        customers=1,
        cats=len(
            list(
                session.scalars(
                    select(Cat.id).where(
                        Cat.customer_id == customer.id,
                        Cat.seed_source == DEMO_SYSTEM_KEY,
                    )
                )
            )
        ),
        orders=len(order_ids),
        tasks=(
            len(
                list(
                    session.scalars(
                        select(Task.id).where(
                            Task.order_id.in_(order_ids),
                            Task.seed_source == DEMO_SYSTEM_KEY,
                        )
                    )
                )
            )
            if order_ids
            else 0
        ),
        payments=(
            len(
                list(
                    session.scalars(
                        select(Payment.id).where(
                            Payment.order_id.in_(order_ids),
                            Payment.seed_source == DEMO_SYSTEM_KEY,
                        )
                    )
                )
            )
            if order_ids
            else 0
        ),
    )


def demo_data_was_cleared(session: Session) -> bool:
    return session.get(SystemFlag, DEMO_CLEARED_FLAG) is not None


def clear_demo_data(session: Session) -> DemoDataCounts:
    customer = session.scalar(
        select(Customer).where(Customer.system_key == DEMO_SYSTEM_KEY)
    )
    if customer is None:
        counts = DemoDataCounts(customers=0, cats=0, orders=0, tasks=0, payments=0)
    else:
        if customer.seed_source != DEMO_SYSTEM_KEY:
            raise HTTPException(status_code=409, detail="演示数据来源无法确认，未执行清理")

        cats = list(session.scalars(select(Cat).where(Cat.customer_id == customer.id)))
        orders = list(
            session.scalars(select(Order).where(Order.customer_id == customer.id))
        )
        order_ids = [order.id for order in orders]
        tasks = (
            list(session.scalars(select(Task).where(Task.order_id.in_(order_ids))))
            if order_ids
            else []
        )
        task_ids = [task.id for task in tasks]
        task_items = (
            list(
                session.scalars(
                    select(TaskItem).where(TaskItem.task_id.in_(task_ids))
                )
            )
            if task_ids
            else []
        )
        task_photos = (
            list(
                session.scalars(
                    select(TaskPhoto).where(TaskPhoto.task_id.in_(task_ids))
                )
            )
            if task_ids
            else []
        )
        payments = list(
            session.scalars(
                select(Payment).where(
                    or_(
                        Payment.customer_id == customer.id,
                        Payment.order_id.in_(order_ids) if order_ids else False,
                    )
                )
            )
        )
        linked_cat_ids = (
            set(
                session.scalars(
                    select(OrderCat.cat_id).where(OrderCat.order_id.in_(order_ids))
                )
            )
            if order_ids
            else set()
        )
        marked_cat_ids = {cat.id for cat in cats if cat.seed_source == DEMO_SYSTEM_KEY}
        mixed = any(
            (
                any(cat.seed_source != DEMO_SYSTEM_KEY for cat in cats),
                any(order.seed_source != DEMO_SYSTEM_KEY for order in orders),
                any(task.seed_source != DEMO_SYSTEM_KEY for task in tasks),
                any(item.seed_source != DEMO_SYSTEM_KEY for item in task_items),
                any(photo.seed_source != DEMO_SYSTEM_KEY for photo in task_photos),
                any(payment.seed_source != DEMO_SYSTEM_KEY for payment in payments),
                not linked_cat_ids.issubset(marked_cat_ids),
            )
        )
        if mixed:
            raise HTTPException(
                status_code=409,
                detail="演示客户下存在未标记数据，为避免误删已停止清理",
            )

        counts = DemoDataCounts(
            customers=1,
            cats=len(cats),
            orders=len(orders),
            tasks=len(tasks),
            payments=len(payments),
        )
        payment_ids = [payment.id for payment in payments]
        if payment_ids:
            session.execute(delete(Payment).where(Payment.id.in_(payment_ids)))
        if order_ids:
            session.execute(delete(Order).where(Order.id.in_(order_ids)))
        cat_ids = [cat.id for cat in cats]
        if cat_ids:
            session.execute(delete(Cat).where(Cat.id.in_(cat_ids)))
        session.execute(delete(Customer).where(Customer.id == customer.id))
    flag = session.get(SystemFlag, DEMO_CLEARED_FLAG)
    if flag is None:
        session.add(SystemFlag(key=DEMO_CLEARED_FLAG, payload=counts.model_dump()))
    session.commit()
    return counts
