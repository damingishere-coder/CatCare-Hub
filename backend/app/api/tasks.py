from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.task import (
    TaskChecklistUpdate,
    TaskExceptionCommand,
    TaskExecutionDetail,
    TaskRevisionCommand,
    TaskTextUpdate,
)
from app.services.task_execution import (
    add_task_photo,
    complete_task,
    get_execution_detail,
    load_task_photo,
    mark_task_exception,
    start_task,
    update_task_item,
    update_task_text,
)
from app.services.task_uploads import photo_media_type, resolve_photo_path


router = APIRouter(prefix="/api/admin/tasks", tags=["admin-tasks"])
DatabaseSession = Annotated[Session, Depends(get_db)]
RevisionForm = Annotated[str, Form(pattern=r"^[0-9a-f]{64}$")]


@router.get("/{task_id}", response_model=TaskExecutionDetail)
def get_task_execution(task_id: int, session: DatabaseSession) -> TaskExecutionDetail:
    return get_execution_detail(session, task_id)


@router.post("/{task_id}/start", response_model=TaskExecutionDetail)
def start_task_execution(
    task_id: int,
    payload: TaskRevisionCommand,
    session: DatabaseSession,
) -> TaskExecutionDetail:
    return start_task(session, task_id, payload.expected_revision)


@router.patch("/{task_id}/items/{item_id}", response_model=TaskExecutionDetail)
def update_task_checklist_item(
    task_id: int,
    item_id: int,
    payload: TaskChecklistUpdate,
    session: DatabaseSession,
) -> TaskExecutionDetail:
    return update_task_item(
        session,
        task_id,
        item_id,
        payload.expected_revision,
        payload.completed,
    )


@router.put("/{task_id}/notes", response_model=TaskExecutionDetail)
def save_task_execution_text(
    task_id: int,
    payload: TaskTextUpdate,
    session: DatabaseSession,
) -> TaskExecutionDetail:
    return update_task_text(
        session,
        task_id,
        payload.expected_revision,
        notes=payload.notes,
        cat_status=payload.cat_status,
    )


@router.post("/{task_id}/photos", response_model=TaskExecutionDetail)
async def upload_task_photo(
    task_id: int,
    session: DatabaseSession,
    expected_revision: RevisionForm,
    photo: Annotated[UploadFile, File()],
) -> TaskExecutionDetail:
    try:
        return await add_task_photo(session, task_id, expected_revision, photo)
    finally:
        await photo.close()


@router.get("/{task_id}/photos/{photo_id}", response_class=FileResponse)
def read_task_photo(
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


@router.post("/{task_id}/complete", response_model=TaskExecutionDetail)
def complete_task_execution(
    task_id: int,
    payload: TaskRevisionCommand,
    session: DatabaseSession,
) -> TaskExecutionDetail:
    return complete_task(session, task_id, payload.expected_revision)


@router.post("/{task_id}/exception", response_model=TaskExecutionDetail)
def mark_task_execution_exception(
    task_id: int,
    payload: TaskExceptionCommand,
    session: DatabaseSession,
) -> TaskExecutionDetail:
    return mark_task_exception(
        session,
        task_id,
        payload.expected_revision,
        payload.exception_notes,
    )
