from app.models.customer import Customer
from app.schemas.customer import CustomerCreate


def build_customer(payload: CustomerCreate) -> Customer:
    """Build a customer without committing so callers can own the transaction."""

    values = payload.model_dump()
    has_geocode_address = any(
        values.get(field) for field in ("community", "address", "building")
    )
    return Customer(
        **values,
        geocode_status="pending" if has_geocode_address else "missing",
    )
