from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.maps import MapProviderError, MapServices
from app.maps.factory import get_map_services
from app.schemas.settings import (
    IntegrationSettingsRead,
    IntegrationState,
    IntegrationTestRequest,
    IntegrationTestResult,
)
from app.services.route_recommendation import (
    OpenAIRouteRecommender,
    RouteRecommendationError,
    get_route_recommender,
)


router = APIRouter(prefix="/api/admin/settings", tags=["admin-settings"])
MapServicesDependency = Annotated[MapServices, Depends(get_map_services)]
RouteRecommenderDependency = Annotated[
    OpenAIRouteRecommender,
    Depends(get_route_recommender),
]


def _state(name: str, configured: bool, message: str | None) -> IntegrationState:
    return IntegrationState(
        name=name,
        configured=configured,
        status="configured" if configured else "not_configured",
        message=message,
    )


@router.get("/integrations", response_model=IntegrationSettingsRead)
def get_integration_settings(
    services: MapServicesDependency,
    recommender: RouteRecommenderDependency,
) -> IntegrationSettingsRead:
    amap = services.map_provider.provider_state()
    gpt = recommender.provider_state()
    return IntegrationSettingsRead(
        amap_backend=_state(amap.name, amap.configured, amap.message),
        gpt_recommendation=_state(gpt.name, gpt.configured, gpt.message),
    )


@router.post("/integrations/test", response_model=IntegrationTestResult)
def test_integration(
    payload: IntegrationTestRequest,
    services: MapServicesDependency,
    recommender: RouteRecommenderDependency,
) -> IntegrationTestResult:
    try:
        if payload.target == "amap":
            state = services.map_provider.provider_state()
            if not state.configured:
                raise MapProviderError(state.message or "高德后端尚未配置")
            if services.geocode_provider.geocode("杭州市民中心") is None:
                raise MapProviderError("高德未返回公开测试地点的坐标")
            return IntegrationTestResult(
                target="amap",
                connected=True,
                message="高德 Web 服务连接测试通过",
            )
        recommender.test_connection()
        return IntegrationTestResult(
            target="openai",
            connected=True,
            message="OpenAI Responses API 连接测试通过",
        )
    except (MapProviderError, RouteRecommendationError) as cause:
        raise HTTPException(status_code=502, detail=str(cause)) from cause
