from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.maps import MapProviderError, MapServices, RouteStop
from app.maps.factory import get_map_services
from app.db.session import get_db
from app.schemas.settings import (
    IntegrationSettingsRead,
    IntegrationState,
    IntegrationTestRequest,
    IntegrationTestResult,
    DemoDataClearRequest,
    DemoDataClearResult,
    DemoDataPreview,
)
from app.services.demo_data import (
    DEMO_SYSTEM_KEY,
    clear_demo_data,
    demo_data_counts,
    demo_data_was_cleared,
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
DatabaseSession = Annotated[Session, Depends(get_db)]


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
            geocoded = services.geocode_provider.geocode("深圳市龙岗区龙岗区政府")
            home = services.map_provider.home_point()
            if geocoded is None or home is None:
                raise MapProviderError("高德未返回公开测试地点的坐标")
            services.route_provider.plan_route(
                home,
                [
                    RouteStop(
                        task_id=0,
                        label="公开测试地点",
                        position=geocoded.point,
                        original_index=0,
                    ),
                    RouteStop(
                        task_id=0,
                        label="家",
                        position=home,
                        original_index=1,
                    ),
                ],
            )
            return IntegrationTestResult(
                target="amap",
                connected=True,
                message="高德地理编码与电动车闭环路线测试通过",
            )
        recommender.test_connection()
        return IntegrationTestResult(
            target="openai",
            connected=True,
            message="OpenAI Responses API 连接测试通过",
        )
    except (MapProviderError, RouteRecommendationError) as cause:
        raise HTTPException(status_code=502, detail=str(cause)) from cause


@router.get("/demo-data", response_model=DemoDataPreview)
def preview_demo_data(session: DatabaseSession) -> DemoDataPreview:
    return DemoDataPreview(
        system_key=DEMO_SYSTEM_KEY,
        already_cleared=demo_data_was_cleared(session),
        counts=demo_data_counts(session),
    )


@router.post("/demo-data/clear", response_model=DemoDataClearResult)
def permanently_clear_demo_data(
    payload: DemoDataClearRequest,
    session: DatabaseSession,
) -> DemoDataClearResult:
    counts = clear_demo_data(session)
    return DemoDataClearResult(
        system_key=payload.system_key,
        already_cleared=True,
        counts=counts,
        cleared=sum(counts.model_dump().values()) > 0,
    )
