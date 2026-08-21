from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.dashboard import DashboardPhotoSent, DashboardResponse
from app.schemas.task import TaskRevisionCommand
from app.services.dashboard import get_dashboard, mark_task_photos_sent


router = APIRouter(prefix="/api/admin/dashboard", tags=["admin-dashboard"])
DatabaseSession = Annotated[Session, Depends(get_db)]
BusinessDateQuery = Annotated[date | None, Query(alias="date")]


@router.get("", response_model=DashboardResponse)
def read_dashboard(
    session: DatabaseSession,
    business_date: BusinessDateQuery = None,
) -> DashboardResponse:
    return get_dashboard(session, business_date)


@router.post("/tasks/{task_id}/photos-sent", response_model=DashboardPhotoSent)
def mark_dashboard_task_photos_sent(
    task_id: int,
    payload: TaskRevisionCommand,
    session: DatabaseSession,
) -> DashboardPhotoSent:
    return mark_task_photos_sent(session, task_id, payload.expected_revision)
