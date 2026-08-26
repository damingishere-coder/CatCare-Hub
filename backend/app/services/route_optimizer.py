from dataclasses import dataclass
from datetime import time as TimeValue
from math import asin, cos, radians, sin, sqrt

from app.maps import GeoPoint


EARTH_RADIUS_METERS = 6_371_008.8
EXACT_ROUTE_LIMIT = 12
HEURISTIC_START_LIMIT = 8
HEURISTIC_TWO_OPT_PASSES = 16


@dataclass(frozen=True)
class RouteCandidate:
    task_id: int
    position: GeoPoint
    original_index: int
    planned_time: TimeValue | None


@dataclass(frozen=True)
class RouteOptimization:
    method: str
    baseline: tuple[RouteCandidate, ...]
    optimized: tuple[RouteCandidate, ...]
    baseline_distance_meters: int
    optimized_distance_meters: int
    estimated_savings_percent: float


def _distance(origin: GeoPoint, destination: GeoPoint) -> float:
    latitude_delta = radians(destination.latitude - origin.latitude)
    longitude_delta = radians(destination.longitude - origin.longitude)
    origin_latitude = radians(origin.latitude)
    destination_latitude = radians(destination.latitude)
    value = (
        sin(latitude_delta / 2) ** 2
        + cos(origin_latitude)
        * cos(destination_latitude)
        * sin(longitude_delta / 2) ** 2
    )
    return EARTH_RADIUS_METERS * 2 * asin(min(1.0, sqrt(value)))


def _closed_distance(home: GeoPoint, route: list[RouteCandidate]) -> float:
    if not route:
        return 0.0
    points = [home, *(candidate.position for candidate in route), home]
    return sum(_distance(origin, destination) for origin, destination in zip(points, points[1:]))


def _tie_key(candidate: RouteCandidate) -> tuple[int, int]:
    return candidate.original_index, candidate.task_id


def _anchor_order(candidates: list[RouteCandidate]) -> list[int]:
    return [
        candidate.task_id
        for candidate in sorted(
            (candidate for candidate in candidates if candidate.planned_time is not None),
            key=lambda candidate: (
                candidate.planned_time,
                candidate.original_index,
                candidate.task_id,
            ),
        )
    ]


def _exact_route(home: GeoPoint, candidates: list[RouteCandidate]) -> list[RouteCandidate]:
    if not candidates:
        return []
    anchor_ids = _anchor_order(candidates)
    candidate_index = {candidate.task_id: index for index, candidate in enumerate(candidates)}
    earlier_anchor_masks: dict[int, int] = {}
    accumulated_mask = 0
    for task_id in anchor_ids:
        index = candidate_index[task_id]
        earlier_anchor_masks[index] = accumulated_mask
        accumulated_mask |= 1 << index

    states: dict[tuple[int, int], tuple[float, tuple[int, ...]]] = {}
    for index, candidate in enumerate(candidates):
        if earlier_anchor_masks.get(index, 0):
            continue
        states[(1 << index, index)] = (
            _distance(home, candidate.position),
            (index,),
        )

    full_mask = (1 << len(candidates)) - 1
    for mask in range(1, full_mask + 1):
        for last in range(len(candidates)):
            state = states.get((mask, last))
            if state is None:
                continue
            cost, path = state
            for following in range(len(candidates)):
                bit = 1 << following
                if mask & bit:
                    continue
                if earlier_anchor_masks.get(following, 0) & ~mask:
                    continue
                next_mask = mask | bit
                next_cost = cost + _distance(
                    candidates[last].position,
                    candidates[following].position,
                )
                next_path = (*path, following)
                existing = states.get((next_mask, following))
                if existing is None or (
                    next_cost < existing[0] - 1e-9
                    or (
                        abs(next_cost - existing[0]) <= 1e-9
                        and tuple(_tie_key(candidates[item]) for item in next_path)
                        < tuple(_tie_key(candidates[item]) for item in existing[1])
                    )
                ):
                    states[(next_mask, following)] = (next_cost, next_path)

    best: tuple[float, tuple[int, ...]] | None = None
    for last in range(len(candidates)):
        state = states.get((full_mask, last))
        if state is None:
            continue
        total = state[0] + _distance(candidates[last].position, home)
        candidate_state = (total, state[1])
        if best is None or (
            total < best[0] - 1e-9
            or (
                abs(total - best[0]) <= 1e-9
                and tuple(_tie_key(candidates[item]) for item in state[1])
                < tuple(_tie_key(candidates[item]) for item in best[1])
            )
        ):
            best = candidate_state

    if best is None:
        return sorted(candidates, key=_tie_key)
    return [candidates[index] for index in best[1]]


def _eligible_candidates(
    remaining: list[RouteCandidate],
    anchor_ids: list[int],
) -> list[RouteCandidate]:
    remaining_ids = {candidate.task_id for candidate in remaining}
    next_anchor = next((task_id for task_id in anchor_ids if task_id in remaining_ids), None)
    return [
        candidate
        for candidate in remaining
        if candidate.planned_time is None or candidate.task_id == next_anchor
    ]


def _nearest_route(
    home: GeoPoint,
    candidates: list[RouteCandidate],
    first: RouteCandidate,
) -> list[RouteCandidate]:
    anchor_ids = _anchor_order(candidates)
    remaining = [candidate for candidate in candidates if candidate.task_id != first.task_id]
    route = [first]
    current = first.position
    while remaining:
        eligible = _eligible_candidates(remaining, anchor_ids)
        following = min(
            eligible,
            key=lambda candidate: (
                _distance(current, candidate.position),
                _tie_key(candidate),
            ),
        )
        route.append(following)
        remaining.remove(following)
        current = following.position
    return route


def _two_opt(home: GeoPoint, route: list[RouteCandidate]) -> list[RouteCandidate]:
    current = list(route)
    for _ in range(HEURISTIC_TWO_OPT_PASSES):
        best_delta = -1e-9
        best_segment: tuple[int, int] | None = None
        anchor_prefix = [0]
        for candidate in current:
            anchor_prefix.append(
                anchor_prefix[-1] + (1 if candidate.planned_time is not None else 0)
            )
        for start in range(len(current) - 1):
            for end in range(start + 1, len(current)):
                if anchor_prefix[end + 1] - anchor_prefix[start] > 1:
                    continue
                before = home if start == 0 else current[start - 1].position
                after = home if end == len(current) - 1 else current[end + 1].position
                delta = (
                    _distance(before, current[end].position)
                    + _distance(current[start].position, after)
                    - _distance(before, current[start].position)
                    - _distance(current[end].position, after)
                )
                if delta < best_delta:
                    best_delta = delta
                    best_segment = (start, end)
        if best_segment is None:
            break
        start, end = best_segment
        current[start : end + 1] = reversed(current[start : end + 1])
    return current


def _heuristic_route(home: GeoPoint, candidates: list[RouteCandidate]) -> list[RouteCandidate]:
    anchor_ids = _anchor_order(candidates)
    initial = _eligible_candidates(candidates, anchor_ids)
    starts = sorted(
        initial,
        key=lambda candidate: (_distance(home, candidate.position), _tie_key(candidate)),
    )[:HEURISTIC_START_LIMIT]
    routes = [_two_opt(home, _nearest_route(home, candidates, first)) for first in starts]
    return min(
        routes,
        key=lambda route: (
            _closed_distance(home, route),
            tuple(_tie_key(candidate) for candidate in route),
        ),
    )


def optimize_closed_route(
    home: GeoPoint,
    candidates: list[RouteCandidate],
) -> RouteOptimization:
    baseline = list(candidates)
    if not candidates:
        optimized: list[RouteCandidate] = []
        method = "none"
    elif len(candidates) <= EXACT_ROUTE_LIMIT:
        optimized = _exact_route(home, candidates)
        method = "exact"
    else:
        optimized = _heuristic_route(home, candidates)
        method = "two_opt"

    baseline_distance = _closed_distance(home, baseline)
    optimized_distance = _closed_distance(home, optimized)
    savings = (
        round(((baseline_distance - optimized_distance) / baseline_distance) * 100, 1)
        if baseline_distance > 0
        else 0.0
    )
    return RouteOptimization(
        method=method,
        baseline=tuple(baseline),
        optimized=tuple(optimized),
        baseline_distance_meters=round(baseline_distance),
        optimized_distance_meters=round(optimized_distance),
        estimated_savings_percent=savings,
    )
