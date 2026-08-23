import json
from datetime import time
from types import SimpleNamespace

import httpx
import pytest

from app.maps import GeoPoint, MatrixEntry, RouteStop
from app.services.route_recommendation import (
    OpenAIRouteRecommender,
    RouteRecommendationError,
)


def _task(task_id: int) -> SimpleNamespace:
    return SimpleNamespace(
        id=task_id,
        planned_time=time((9 + task_id) % 24, 0),
        status=SimpleNamespace(value="confirmed"),
        order=SimpleNamespace(
            service_items=["feed", "photo"],
            contact_name=f"不得外发姓名-{task_id}",
            contact_phone=f"不得外发电话-{task_id}",
            contact_address=f"不得外发地址-{task_id}",
            contact_access_info=f"不得外发门禁-{task_id}",
            contact_key_code=f"不得外发钥匙-{task_id}",
            contact_notes=f"不得外发备注-{task_id}",
        ),
    )


def _stops(count: int = 2) -> list[RouteStop]:
    return [
        RouteStop(
            task_id=index,
            label=f"不得外发站点-{index}",
            position=GeoPoint(30 + index / 100, 120 + index / 100),
            original_index=index - 1,
        )
        for index in range(1, count + 1)
    ]


def _matrix() -> list[MatrixEntry]:
    return [
        MatrixEntry("HOME", "1", 1000, 300),
        MatrixEntry("HOME", "2", 800, 240),
        MatrixEntry("1", "2", 500, 180),
        MatrixEntry("2", "1", 600, 200),
    ]


def test_openai_recommendation_uses_strict_anonymous_responses_request() -> None:
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(
            200,
            json={"output_text": json.dumps({"task_ids": [2, 1]})},
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    recommender = OpenAIRouteRecommender(
        api_key="FAKE-OPENAI-KEY",
        model="gpt-5.6",
        client=client,
    )
    stops = _stops()
    recommended = recommender.recommend(
        tasks=[_task(1), _task(2)],
        stops=stops,
        matrix=_matrix(),
    )

    assert [stop.task_id for stop in recommended] == [2, 1]
    body = json.loads(captured[0].content)
    assert body["model"] == "gpt-5.6"
    assert body["store"] is False
    assert body["text"]["format"]["type"] == "json_schema"
    assert body["text"]["format"]["strict"] is True
    anonymous_input = json.loads(body["input"])
    assert anonymous_input == {
        "tasks": [
            {
                "task_id": 1,
                "planned_time": "10:00:00",
                "service_item_flags": ["feed", "photo"],
            },
            {
                "task_id": 2,
                "planned_time": "11:00:00",
                "service_item_flags": ["feed", "photo"],
            },
        ],
        "travel_matrix": [
            {
                "from": entry.origin_id,
                "to": entry.destination_id,
                "distance_meters": entry.distance_meters,
                "duration_seconds": entry.duration_seconds,
            }
            for entry in _matrix()
        ],
    }
    serialized = captured[0].content.decode("utf-8")
    for forbidden in (
        "不得外发姓名",
        "不得外发电话",
        "不得外发地址",
        "不得外发站点",
        "不得外发门禁",
        "不得外发钥匙",
        "不得外发备注",
        "FAKE-OPENAI-KEY",
    ):
        assert forbidden not in serialized
    client.close()


@pytest.mark.parametrize(
    "output",
    (
        {"task_ids": [1, 1]},
        {"task_ids": [1]},
        {"task_ids": [1, 3]},
        {"task_ids": ["1", 2]},
    ),
)
def test_openai_recommendation_rejects_incomplete_duplicate_or_unknown_ids(
    output: dict[str, object],
) -> None:
    client = httpx.Client(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200,
                json={"output_text": json.dumps(output)},
            )
        )
    )
    recommender = OpenAIRouteRecommender(api_key="FAKE", client=client)
    with pytest.raises(RouteRecommendationError, match="不完整或重复"):
        recommender.recommend(
            tasks=[_task(1), _task(2)],
            stops=_stops(),
            matrix=_matrix(),
        )
    client.close()


def test_openai_recommendation_timeout_and_over_twenty_stops_are_safe() -> None:
    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("虚构超时", request=request)

    client = httpx.Client(transport=httpx.MockTransport(timeout))
    recommender = OpenAIRouteRecommender(api_key="FAKE", client=client)
    with pytest.raises(RouteRecommendationError, match="超时"):
        recommender.recommend(
            tasks=[_task(1), _task(2)],
            stops=_stops(),
            matrix=_matrix(),
        )
    with pytest.raises(RouteRecommendationError, match="超过 20"):
        recommender.recommend(
            tasks=[_task(index) for index in range(1, 22)],
            stops=_stops(21),
            matrix=[],
        )
    client.close()
