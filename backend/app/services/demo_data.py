from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models.customer import Cat, Customer
from app.models.order import Order
from app.models.payment import Payment
from app.models.system import SystemFlag
from app.models.task import Task
from app.schemas.settings import DemoDataCounts


DEMO_SYSTEM_KEY = "catcare-demo-seed-v1"
DEMO_CLEARED_FLAG = "demo-data-cleared:catcare-demo-seed-v1"


def demo_data_counts(session: Session) -> DemoDataCounts:
    customer_id = session.scalar(
        select(Customer.id).where(Customer.system_key == DEMO_SYSTEM_KEY)
    )
    if customer_id is None:
        return DemoDataCounts(customers=0, cats=0, orders=0, tasks=0, payments=0)
    order_ids = select(Order.id).where(Order.customer_id == customer_id)
    return DemoDataCounts(
        customers=1,
        cats=int(
            session.scalar(select(func.count(Cat.id)).where(Cat.customer_id == customer_id))
            or 0
        ),
        orders=int(session.scalar(select(func.count()).select_from(order_ids.subquery())) or 0),
        tasks=int(session.scalar(select(func.count(Task.id)).where(Task.order_id.in_(order_ids))) or 0),
        payments=int(
            session.scalar(select(func.count(Payment.id)).where(Payment.order_id.in_(order_ids)))
            or 0
        ),
    )


def demo_data_was_cleared(session: Session) -> bool:
    return session.get(SystemFlag, DEMO_CLEARED_FLAG) is not None


def clear_demo_data(session: Session) -> DemoDataCounts:
    counts = demo_data_counts(session)
    customer_id = session.scalar(
        select(Customer.id).where(Customer.system_key == DEMO_SYSTEM_KEY)
    )
    if customer_id is not None:
        order_ids = select(Order.id).where(Order.customer_id == customer_id)
        session.execute(delete(Payment).where(Payment.order_id.in_(order_ids)))
        session.execute(delete(Order).where(Order.customer_id == customer_id))
        session.execute(delete(Customer).where(Customer.id == customer_id))
    flag = session.get(SystemFlag, DEMO_CLEARED_FLAG)
    if flag is None:
        session.add(SystemFlag(key=DEMO_CLEARED_FLAG, payload=counts.model_dump()))
    session.commit()
    return counts
