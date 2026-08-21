from datetime import date, datetime, timedelta, timezone


BUSINESS_TIMEZONE = timezone(timedelta(hours=8), name="Asia/Shanghai")


def as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def current_business_date() -> date:
    return datetime.now(BUSINESS_TIMEZONE).date()


def business_day_bounds_utc(business_date: date) -> tuple[datetime, datetime]:
    local_start = datetime.combine(
        business_date,
        datetime.min.time(),
        tzinfo=BUSINESS_TIMEZONE,
    )
    local_end = local_start + timedelta(days=1)
    return local_start.astimezone(timezone.utc), local_end.astimezone(timezone.utc)


def business_month_bounds_utc(business_date: date) -> tuple[datetime, datetime]:
    local_start = datetime(
        business_date.year,
        business_date.month,
        1,
        tzinfo=BUSINESS_TIMEZONE,
    )
    if business_date.month == 12:
        local_end = datetime(
            business_date.year + 1,
            1,
            1,
            tzinfo=BUSINESS_TIMEZONE,
        )
    else:
        local_end = datetime(
            business_date.year,
            business_date.month + 1,
            1,
            tzinfo=BUSINESS_TIMEZONE,
        )
    return local_start.astimezone(timezone.utc), local_end.astimezone(timezone.utc)
