from datetime import time

from app.maps import GeoPoint, GeocodeResult
from app.services.geocoding import geocode_result_matches_address
from app.services.route_optimizer import RouteCandidate, optimize_closed_route


def candidate(
    task_id: int,
    latitude: float,
    longitude: float,
    original_index: int,
    planned_time: time | None = None,
) -> RouteCandidate:
    return RouteCandidate(
        task_id=task_id,
        position=GeoPoint(latitude, longitude),
        original_index=original_index,
        planned_time=planned_time,
    )


def test_exact_optimizer_improves_closed_route_deterministically() -> None:
    home = GeoPoint(0, 0)
    candidates = [
        candidate(1, 0, 2, 0),
        candidate(2, 0, 1, 1),
        candidate(3, 1, 0, 2),
    ]

    first = optimize_closed_route(home, candidates)
    second = optimize_closed_route(home, candidates)

    assert first.method == "exact"
    assert first.optimized_distance_meters < first.baseline_distance_meters
    assert [item.task_id for item in first.optimized] == [2, 1, 3]
    assert first == second


def test_planned_times_are_precedence_anchors_and_ties_keep_original_order() -> None:
    result = optimize_closed_route(
        GeoPoint(0, 0),
        [
            candidate(1, 0, 3, 0, time(10, 0)),
            candidate(2, 0, 2, 1, time(9, 0)),
            candidate(3, 0, 1, 2),
            candidate(4, 1, 0, 3, time(10, 0)),
        ],
    )
    task_ids = [item.task_id for item in result.optimized]

    assert task_ids.index(2) < task_ids.index(1) < task_ids.index(4)


def test_large_day_uses_deterministic_two_opt_and_keeps_anchor_order() -> None:
    candidates = [
        candidate(
            task_id=index + 1,
            latitude=(index % 4) * 0.01,
            longitude=(index // 4) * 0.01,
            original_index=index,
            planned_time=(time(9 + index // 5, 0) if index in {0, 5, 10} else None),
        )
        for index in range(13)
    ]

    first = optimize_closed_route(GeoPoint(0, 0), candidates)
    second = optimize_closed_route(GeoPoint(0, 0), candidates)
    task_ids = [item.task_id for item in first.optimized]

    assert first.method == "two_opt"
    assert first == second
    assert task_ids.index(1) < task_ids.index(6) < task_ids.index(11)
    assert first.optimized_distance_meters <= first.baseline_distance_meters


def test_geocode_region_validation_accepts_local_and_explicit_external_addresses() -> None:
    longgang = GeocodeResult(
        GeoPoint(22.63, 114.05),
        city="深圳市",
        district="龙岗区",
        adcode="440307",
        level="门牌号",
    )
    guangzhou = GeocodeResult(
        GeoPoint(23.13, 113.26),
        city="广州市",
        district="越秀区",
        adcode="440104",
        level="门牌号",
    )

    assert geocode_result_matches_address("深圳市龙岗区长坑三巷21号", longgang)
    assert geocode_result_matches_address("广州市越秀区中山五路1号", guangzhou)
    assert not geocode_result_matches_address("深圳市龙岗区长坑三巷21号", guangzhou)
