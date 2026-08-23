from app.models.customer import Customer
from app.schemas.customer import CustomerCreate


def customer_display_address(customer: Customer) -> str | None:
    preferred = customer.address.strip() if customer.address else ""
    if preferred:
        return preferred
    parts = [customer.community, customer.building, customer.unit, customer.room]
    normalized = [part.strip() for part in parts if part and part.strip()]
    unique = list(dict.fromkeys(normalized))
    return " ".join(unique) or None


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
