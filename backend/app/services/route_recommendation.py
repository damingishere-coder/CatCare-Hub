import json
import os
from dataclasses import dataclass
from typing import Any, Literal

import httpx

from app.maps import MatrixEntry, RouteStop
from app.models.task import Task


MAX_GPT_STOPS = 20
OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"


class RouteRecommendationError(RuntimeError):
    """A safe, user-facing failure that should trigger local fallback."""


@dataclass(frozen=True)
class RecommendationProviderState:
    name: str
    configured: bool
    message: str | None = None


@dataclass(frozen=True)
class RouteRecommendation:
    stops: list[RouteStop]
    source: Literal["openai", "local"]
    message: str | None = None


class OpenAIRouteRecommender:
    def __init__(
        self,
        *,
        api_key: str,
        model: str = "gpt-5.6",
        timeout_seconds: float = 15.0,
        client: httpx.Client | None = None,
    ) -> None:
        self._api_key = api_key.strip()
        self._model = model.strip() or "gpt-5.6"
        self._timeout_seconds = timeout_seconds
        self._client = client

    def provider_state(self) -> RecommendationProviderState:
        if not self._api_key:
            return RecommendationProviderState(
                name="openai",
                configured=False,
                message="未配置独立 OpenAI API Key",
            )
        return RecommendationProviderState(name="openai", configured=True)

    @staticmethod
    def _anonymous_input(
        tasks: list[Task],
        matrix: list[MatrixEntry],
    ) -> dict[str, object]:
        return {
            "tasks": [
                {
                    "task_id": task.id,
                    "planned_time": (
                        task.planned_time.isoformat() if task.planned_time else None
                    ),
                    "service_item_flags": sorted(task.order.service_items),
                }
                for task in tasks
                if task.status.value != "cancelled"
            ],
            "travel_matrix": [
                {
                    "from": entry.origin_id,
                    "to": entry.destination_id,
                    "distance_meters": entry.distance_meters,
                    "duration_seconds": entry.duration_seconds,
                }
                for entry in matrix
            ],
        }

    @staticmethod
    def _output_text(payload: dict[str, Any]) -> str:
        direct = payload.get("output_text")
        if isinstance(direct, str):
            return direct
        output = payload.get("output")
        if isinstance(output, list):
            for item in output:
                if not isinstance(item, dict) or item.get("type") != "message":
                    continue
                content = item.get("content")
                if not isinstance(content, list):
                    continue
                for part in content:
                    if isinstance(part, dict) and part.get("type") == "output_text":
                        text = part.get("text")
                        if isinstance(text, str):
                            return text
        raise RouteRecommendationError("GPT 未返回可读取的路线建议")

    def recommend(
        self,
        *,
        tasks: list[Task],
        stops: list[RouteStop],
        matrix: list[MatrixEntry],
    ) -> list[RouteStop]:
        if not self._api_key:
            raise RouteRecommendationError("未配置独立 OpenAI API Key")
        if len(stops) > MAX_GPT_STOPS:
            raise RouteRecommendationError("单日超过 20 个站点")
        expected_ids = [stop.task_id for stop in stops]
        if not expected_ids:
            return []
        body = {
            "model": self._model,
            "store": False,
            "reasoning": {"effort": "medium"},
            "instructions": (
                "你是上门服务路线排序器。只根据匿名任务编号、计划时间、"
                "服务事项标志和地图服务真实路线矩阵，输出完整且无重复的任务编号顺序。"
            ),
            "input": json.dumps(
                self._anonymous_input(tasks, matrix),
                ensure_ascii=False,
                separators=(",", ":"),
            ),
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "catcare_route_order",
                    "strict": True,
                    "schema": {
                        "type": "object",
                        "properties": {
                            "task_ids": {
                                "type": "array",
                                "items": {"type": "integer"},
                                "minItems": len(expected_ids),
                                "maxItems": len(expected_ids),
                            }
                        },
                        "required": ["task_ids"],
                        "additionalProperties": False,
                    },
                }
            },
            "max_output_tokens": 800,
        }
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        client = self._client
        try:
            if client is not None:
                response = client.post(
                    OPENAI_RESPONSES_URL,
                    headers=headers,
                    json=body,
                )
            else:
                with httpx.Client(timeout=self._timeout_seconds) as temporary:
                    response = temporary.post(
                        OPENAI_RESPONSES_URL,
                        headers=headers,
                        json=body,
                    )
            response.raise_for_status()
            response_payload = response.json()
        except httpx.TimeoutException as cause:
            raise RouteRecommendationError("GPT 路线建议超时") from cause
        except httpx.HTTPStatusError as cause:
            status_code = cause.response.status_code
            if status_code == 429:
                message = "GPT 路线建议已限流"
            elif status_code in {401, 403}:
                message = "OpenAI API Key 无效或权限不足"
            else:
                message = "GPT 路线建议暂时不可用"
            raise RouteRecommendationError(message) from cause
        except (httpx.HTTPError, ValueError) as cause:
            raise RouteRecommendationError("GPT 路线建议暂时不可用") from cause

        try:
            parsed = json.loads(self._output_text(response_payload))
            recommended_ids = parsed["task_ids"]
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as cause:
            raise RouteRecommendationError("GPT 返回了无效路线顺序") from cause
        if (
            not isinstance(recommended_ids, list)
            or any(not isinstance(task_id, int) for task_id in recommended_ids)
            or len(recommended_ids) != len(expected_ids)
            or len(set(recommended_ids)) != len(recommended_ids)
            or set(recommended_ids) != set(expected_ids)
        ):
            raise RouteRecommendationError("GPT 返回了不完整或重复的任务顺序")
        stops_by_id = {stop.task_id: stop for stop in stops}
        return [stops_by_id[task_id] for task_id in recommended_ids]

    def test_connection(self) -> None:
        if not self._api_key:
            raise RouteRecommendationError("未配置独立 OpenAI API Key")
        body = {
            "model": self._model,
            "store": False,
            "input": "仅返回连接测试结果。",
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "catcare_connection_test",
                    "strict": True,
                    "schema": {
                        "type": "object",
                        "properties": {"ok": {"type": "boolean"}},
                        "required": ["ok"],
                        "additionalProperties": False,
                    },
                }
            },
            "max_output_tokens": 64,
        }
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        try:
            if self._client is not None:
                response = self._client.post(
                    OPENAI_RESPONSES_URL,
                    headers=headers,
                    json=body,
                )
            else:
                with httpx.Client(timeout=self._timeout_seconds) as temporary:
                    response = temporary.post(
                        OPENAI_RESPONSES_URL,
                        headers=headers,
                        json=body,
                    )
            response.raise_for_status()
            payload = response.json()
            result = json.loads(self._output_text(payload))
        except httpx.TimeoutException as cause:
            raise RouteRecommendationError("OpenAI 连接测试超时") from cause
        except httpx.HTTPStatusError as cause:
            if cause.response.status_code == 429:
                message = "OpenAI 连接测试已限流"
            elif cause.response.status_code in {401, 403}:
                message = "OpenAI API Key 无效或权限不足"
            else:
                message = "OpenAI 连接测试失败"
            raise RouteRecommendationError(message) from cause
        except (httpx.HTTPError, ValueError, TypeError, KeyError) as cause:
            raise RouteRecommendationError("OpenAI 连接测试失败") from cause
        if result != {"ok": True}:
            raise RouteRecommendationError("OpenAI 返回了无效连接测试结果")


def _timeout_seconds() -> float:
    try:
        value = float(os.getenv("CATCARE_OPENAI_TIMEOUT_SECONDS", "15"))
    except ValueError:
        value = 15.0
    return min(max(value, 2.0), 30.0)


def get_route_recommender() -> OpenAIRouteRecommender:
    return OpenAIRouteRecommender(
        api_key=os.getenv("OPENAI_API_KEY", ""),
        model=os.getenv("CATCARE_OPENAI_ROUTE_MODEL", "gpt-5.6"),
        timeout_seconds=_timeout_seconds(),
    )
