from datetime import date
from decimal import Decimal

from app.services.orders import calculate_order_pricing, default_geocode_service_area


def test_default_geocode_service_area_only_fills_missing_local_regions() -> None:
    assert default_geocode_service_area("长坑三巷21号") == "深圳市龙岗区长坑三巷21号"
    assert (
        default_geocode_service_area("深圳市坂田街道长坑三巷21号")
        == "深圳市龙岗区坂田街道长坑三巷21号"
    )
    assert (
        default_geocode_service_area("龙岗区坂田街道长坑三巷21号")
        == "深圳市龙岗区坂田街道长坑三巷21号"
    )
    assert (
        default_geocode_service_area("深圳市龙岗区坂田街道长坑三巷21号")
        == "深圳市龙岗区坂田街道长坑三巷21号"
    )
    assert (
        default_geocode_service_area("深圳市宝安区新安街道1号")
        == "深圳市宝安区新安街道1号"
    )
    assert (
        default_geocode_service_area("广州市天河区体育西路1号")
        == "广州市天河区体育西路1号"
    )


def test_seven_day_two_cat_order_pricing() -> None:
    pricing = calculate_order_pricing(
        start_date=date(2030, 10, 1),
        end_date=date(2030, 10, 7),
        visits_per_day=1,
        cat_count=2,
        base_price=Decimal("30"),
        stairs_fee=Decimal("0"),
        other_fee=Decimal("0"),
    )

    assert pricing.service_days == 7
    assert pricing.total_visits == 7
    assert pricing.extra_cat_fee == Decimal("5.00")
    assert pricing.total_amount == Decimal("245.00")


def test_multi_visit_stairs_and_other_fee_pricing() -> None:
    pricing = calculate_order_pricing(
        start_date=date(2030, 10, 1),
        end_date=date(2030, 10, 3),
        visits_per_day=2,
        cat_count=3,
        base_price=Decimal("30"),
        stairs_fee=Decimal("5"),
        other_fee=Decimal("12.34"),
    )

    assert pricing.service_days == 3
    assert pricing.total_visits == 6
    assert pricing.extra_cat_fee == Decimal("10.00")
    assert pricing.total_amount == Decimal("282.34")
