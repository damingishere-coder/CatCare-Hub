from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.maps import MapServices
from app.maps.factory import get_map_services
from app.schemas.mobile import MobileTaskExecutionDetail, MobileTodayRead
from app.schemas.task import (
    TaskChecklistUpdate,
    TaskExecutionDetail,
    TaskRevisionCommand,
    TaskTextUpdate,
)
from app.services.business_time import current_business_date
from app.services.mobile import load_mobile_today, mobile_execution_detail
from app.services.task_execution import (
    add_task_photo,
    complete_task,
    get_execution_detail,
    load_task_photo,
    start_task,
    update_task_item,
    update_task_text,
)
from app.services.task_uploads import photo_media_type, resolve_photo_path


router = APIRouter(prefix="/api/mobile", tags=["mobile"])
DatabaseSession = Annotated[Session, Depends(get_db)]
MapServicesDependency = Annotated[MapServices, Depends(get_map_services)]
RevisionForm = Annotated[str, Form(pattern=r"^[0-9a-f]{64}$")]


def _mobile_detail(
    session: Session,
    detail: TaskExecutionDetail,
    services: MapServices,
) -> MobileTaskExecutionDetail:
    return mobile_execution_detail(session, detail, services=services)


@router.get("/today", response_model=MobileTodayRead)
def get_mobile_today(
    session: DatabaseSession,
    services: MapServicesDependency,
    requested_date: Annotated[date | None, Query(alias="date")] = None,
) -> MobileTodayRead:
    return load_mobile_today(
        session,
        service_date=requested_date or current_business_date(),
        services=services,
    )


@router.get("/tasks/{task_id}", response_model=MobileTaskExecutionDetail)
def get_mobile_task(
    task_id: int,
    session: DatabaseSession,
    services: MapServicesDependency,
) -> MobileTaskExecutionDetail:
    return _mobile_detail(session, get_execution_detail(session, task_id), services)


@router.post("/tasks/{task_id}/start", response_model=MobileTaskExecutionDetail)
def start_mobile_task(
    task_id: int,
    payload: TaskRevisionCommand,
    session: DatabaseSession,
    services: MapServicesDependency,
) -> MobileTaskExecutionDetail:
    return _mobile_detail(
        session,
        start_task(session, task_id, payload.expected_revision),
        services,
    )


@router.patch(
    "/tasks/{task_id}/items/{item_id}",
    response_model=MobileTaskExecutionDetail,
)
def update_mobile_checklist_item(
    task_id: int,
    item_id: int,
    payload: TaskChecklistUpdate,
    session: DatabaseSession,
    services: MapServicesDependency,
) -> MobileTaskExecutionDetail:
    return _mobile_detail(
        session,
        update_task_item(
            session,
            task_id,
            item_id,
            payload.expected_revision,
            payload.completed,
        ),
        services,
    )


@router.put("/tasks/{task_id}/notes", response_model=MobileTaskExecutionDetail)
def save_mobile_task_text(
    task_id: int,
    payload: TaskTextUpdate,
    session: DatabaseSession,
    services: MapServicesDependency,
) -> MobileTaskExecutionDetail:
    return _mobile_detail(
        session,
        update_task_text(
            session,
            task_id,
            payload.expected_revision,
            notes=payload.notes,
            cat_status=payload.cat_status,
        ),
        services,
    )


@router.post("/tasks/{task_id}/photos", response_model=MobileTaskExecutionDetail)
async def upload_mobile_task_photo(
    task_id: int,
    session: DatabaseSession,
    expected_revision: RevisionForm,
    photo: Annotated[UploadFile, File()],
    services: MapServicesDependency,
) -> MobileTaskExecutionDetail:
    try:
        return _mobile_detail(
            session,
            await add_task_photo(session, task_id, expected_revision, photo),
            services,
        )
    finally:
        await photo.close()


@router.get("/tasks/{task_id}/photos/{photo_id}", response_class=FileResponse)
def read_mobile_task_photo(
    task_id: int,
    photo_id: int,
    session: DatabaseSession,
) -> FileResponse:
    photo = load_task_photo(session, task_id, photo_id)
    path = resolve_photo_path(photo.file_url)
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail="任务照片文件不存在")
    media_type = photo_media_type(path)
    if media_type is None:
        raise HTTPException(status_code=404, detail="任务照片格式无效")
    return FileResponse(
        path,
        media_type=media_type,
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post("/tasks/{task_id}/complete", response_model=MobileTaskExecutionDetail)
def complete_mobile_task(
    task_id: int,
    payload: TaskRevisionCommand,
    session: DatabaseSession,
    services: MapServicesDependency,
) -> MobileTaskExecutionDetail:
    return _mobile_detail(
        session,
        complete_task(session, task_id, payload.expected_revision),
        services,
    )
