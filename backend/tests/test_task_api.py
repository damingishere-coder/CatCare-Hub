from collections.abc import Generator
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from app.db.session import build_engine, get_db
from app.main import app
from app.models import Task, TaskPhoto, TaskStatus
from app.services import task_uploads
from app.services.task_execution import (
    execution_revision,
    load_execution_task,
    update_task_text,
)


@dataclass(frozen=True)
class TaskApiContext:
    client: TestClient
    session_factory: sessionmaker[Session]
    upload_root: Path


@pytest.fixture
def task_api_context(
    migrated_database_url: str,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[TaskApiContext, None, None]:
    engine = build_engine(migrated_database_url)
    testing_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    upload_root = (tmp_path / "uploads").resolve()
    monkeypatch.setattr(task_uploads, "UPLOAD_ROOT", upload_root)

    def override_get_db() -> Generator[Session, None, None]:
        with testing_session() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            yield TaskApiContext(
                client=client,
                session_factory=testing_session,
                upload_root=upload_root,
            )
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def image_bytes(image_format: str = "PNG", size: tuple[int, int] = (4, 3)) -> bytes:
    output = BytesIO()
    Image.new("RGB", size, color=(31, 41, 55)).save(output, format=image_format)
    return output.getvalue()


def create_task_order(
    client: TestClient,
    *,
    visits_per_day: int = 1,
    service_items: list[str] | None = None,
) -> dict:
    customer = client.post(
        "/api/admin/customers",
        json={
            "name": "P6 虚构客户",
            "phone": "000-P6-TEST",
            "community": "P6 虚构小区",
            "address": "P6 虚构路 6 号",
            "building": "6 栋",
            "unit": "6 单元",
            "room": "606",
            "access_method": "虚构门禁方式",
            "access_info": "虚构门禁说明",
            "key_status": "虚构钥匙状态",
            "key_code": "FAKE-P6-KEY",
            "notes": "不应进入执行响应的客户内部备注",
        },
    ).json()
    cat = client.post(
        f"/api/admin/customers/{customer['id']}/cats",
        json={
            "name": "P6 虚构猫咪",
            "food": "虚构主粮",
            "food_preference": "虚构口味",
            "litter_type": "虚构猫砂",
            "medication_required": True,
            "medication_notes": "虚构用药说明",
            "special_notes": "虚构特殊情况",
            "service_notes": "虚构服务说明",
        },
    ).json()
    response = client.post(
        "/api/admin/orders",
        json={
            "customer_id": customer["id"],
            "cat_ids": [cat["id"]],
            "start_date": "2035-10-06",
            "end_date": "2035-10-06",
            "visits_per_day": visits_per_day,
            "service_items": service_items or ["feed", "water", "photo"],
            "base_price": "30.00",
            "stairs_fee": "0.00",
            "other_fee": "0.00",
            "order_status": "confirmed",
            "notes": "虚构 P6 订单备注",
        },
    )
    assert response.status_code == 201
    return response.json()


def get_task(client: TestClient, task_id: int) -> dict:
    response = client.get(f"/api/admin/tasks/{task_id}")
    assert response.status_code == 200
    return response.json()


def post_revision(client: TestClient, task_id: int, action: str, revision: str):
    return client.post(
        f"/api/admin/tasks/{task_id}/{action}",
        json={"expected_revision": revision},
    )


def start(client: TestClient, task_id: int) -> dict:
    detail = get_task(client, task_id)
    response = post_revision(client, task_id, "start", detail["revision"])
    assert response.status_code == 200
    return response.json()


def complete_non_photo_items(client: TestClient, detail: dict) -> dict:
    for item in detail["items"]:
        if item["item_type"] == "photo" or item["completed"]:
            continue
        response = client.patch(
            f"/api/admin/tasks/{detail['id']}/items/{item['id']}",
            json={"expected_revision": detail["revision"], "completed": True},
        )
        assert response.status_code == 200
        detail = response.json()
    return detail


def test_task_database_cas_rejects_a_preloaded_stale_session(
    task_api_context: TaskApiContext,
) -> None:
    order = create_task_order(task_api_context.client, service_items=["feed"])
    task_id = order["tasks"][0]["id"]
    started = start(task_api_context.client, task_id)

    with (
        task_api_context.session_factory() as first_session,
        task_api_context.session_factory() as stale_session,
    ):
        first_task = load_execution_task(first_session, task_id)
        stale_task = load_execution_task(stale_session, task_id)
        revision = execution_revision(first_task)
        assert execution_revision(stale_task) == revision == started["revision"]

        saved = update_task_text(
            first_session,
            task_id,
            revision,
            notes="第一会话写入",
            cat_status=None,
        )
        assert saved.notes == "第一会话写入"

        with pytest.raises(HTTPException) as conflict:
            update_task_text(
                stale_session,
                task_id,
                revision,
                notes="不应覆盖",
                cat_status=None,
            )
        assert conflict.value.status_code == 409
        stale_session.rollback()

    assert get_task(task_api_context.client, task_id)["notes"] == "第一会话写入"


def test_execution_detail_start_text_and_revision_protection(
    task_api_context: TaskApiContext,
) -> None:
    client = task_api_context.client
    order = create_task_order(client)
    task_id = order["tasks"][0]["id"]
    detail = get_task(client, task_id)

    assert detail["status"] == "confirmed"
    assert len(detail["revision"]) == 64
    assert detail["customer"] == {
        "id": order["customer"]["id"],
        "name": "P6 虚构客户",
        "phone": "000-P6-TEST",
        "community": "P6 虚构小区",
        "address": "P6 虚构路 6 号",
        "building": "6 栋",
        "unit": "6 单元",
        "room": "606",
        "access_method": "虚构门禁方式",
        "access_info": "虚构门禁说明",
        "key_status": "虚构钥匙状态",
        "key_code": "FAKE-P6-KEY",
    }
    assert "photo_url" not in detail["cats"][0]
    assert "不应进入执行响应的客户内部备注" not in client.get(
        f"/api/admin/tasks/{task_id}"
    ).text
    original_revision = detail["revision"]

    started = start(client, task_id)
    assert started["status"] == "in_progress"
    assert started["started_at"] is not None
    assert started["started_at"].endswith("Z")
    assert started["completed_at"] is None
    assert started["order_status"] == "in_progress"
    assert started["revision"] != original_revision

    stale = client.put(
        f"/api/admin/tasks/{task_id}/notes",
        json={
            "expected_revision": original_revision,
            "notes": "不应保存",
            "cat_status": "不应保存",
        },
    )
    assert stale.status_code == 409

    saved = client.put(
        f"/api/admin/tasks/{task_id}/notes",
        json={
            "expected_revision": started["revision"],
            "notes": "已添粮并观察饮水",
            "cat_status": "精神良好，正常进食",
        },
    )
    assert saved.status_code == 200
    assert saved.json()["notes"] == "已添粮并观察饮水"
    assert saved.json()["cat_status"] == "精神良好，正常进食"

    duplicate_start = post_revision(
        client,
        task_id,
        "start",
        saved.json()["revision"],
    )
    assert duplicate_start.status_code == 409


def test_checklist_photo_upload_read_and_complete_single_task_order(
    task_api_context: TaskApiContext,
) -> None:
    client = task_api_context.client
    order = create_task_order(client)
    detail = start(client, order["tasks"][0]["id"])

    incomplete = post_revision(client, detail["id"], "complete", detail["revision"])
    assert incomplete.status_code == 409
    assert incomplete.json()["detail"] == "请先完成所有必做服务事项"

    photo_item = next(item for item in detail["items"] if item["item_type"] == "photo")
    manual_photo = client.patch(
        f"/api/admin/tasks/{detail['id']}/items/{photo_item['id']}",
        json={"expected_revision": detail["revision"], "completed": True},
    )
    assert manual_photo.status_code == 409

    detail = complete_non_photo_items(client, detail)
    upload = client.post(
        f"/api/admin/tasks/{detail['id']}/photos",
        data={"expected_revision": detail["revision"]},
        files={"photo": ("../../customer-name.png", image_bytes(), "image/png")},
    )
    assert upload.status_code == 200
    detail = upload.json()
    assert next(item for item in detail["items"] if item["item_type"] == "photo")[
        "completed"
    ] is True
    assert len(detail["photos"]) == 1
    photo = detail["photos"][0]
    assert photo["created_at"].endswith("Z")
    assert photo["url"] == f"/api/admin/tasks/{detail['id']}/photos/{photo['id']}"
    assert "customer-name" not in upload.text
    assert str(task_api_context.upload_root) not in upload.text

    with task_api_context.session_factory() as session:
        stored = session.scalar(select(TaskPhoto).where(TaskPhoto.id == photo["id"]))
        assert stored is not None
        assert stored.file_url.startswith("/uploads/tasks/2035/10/06/")
        assert "customer-name" not in stored.file_url
        stored_path = task_uploads.resolve_photo_path(stored.file_url)
        assert stored_path is not None and stored_path.is_file()
        assert stored_path.is_relative_to(task_api_context.upload_root)

    image_response = client.get(photo["url"])
    assert image_response.status_code == 200
    assert image_response.headers["content-type"] == "image/png"
    assert image_response.headers["x-content-type-options"] == "nosniff"
    assert image_response.headers["cache-control"] == "private, no-store"
    assert image_response.content == image_bytes()

    for image_format, filename, media_type in (
        ("JPEG", "second.jpeg", "image/jpeg"),
        ("WEBP", "third.webp", "image/webp"),
    ):
        content = image_bytes(image_format)
        additional = client.post(
            f"/api/admin/tasks/{detail['id']}/photos",
            data={"expected_revision": detail["revision"]},
            files={"photo": (filename, content, media_type)},
        )
        assert additional.status_code == 200
        detail = additional.json()
        additional_photo = detail["photos"][-1]
        retrieved = client.get(additional_photo["url"])
        assert retrieved.status_code == 200
        assert retrieved.headers["content-type"] == media_type
        assert retrieved.content == content
    assert len(detail["photos"]) == 3

    other_order = create_task_order(client, service_items=["feed"])
    other_task_id = other_order["tasks"][0]["id"]
    assert client.get(
        f"/api/admin/tasks/{other_task_id}/photos/{photo['id']}"
    ).status_code == 404

    completed = post_revision(client, detail["id"], "complete", detail["revision"])
    assert completed.status_code == 200
    final = completed.json()
    assert final["status"] == "completed"
    assert final["completed_at"] is not None
    assert final["completed_at"].endswith("Z")
    assert final["order_status"] == "completed"
    assert client.put(
        f"/api/admin/tasks/{detail['id']}/notes",
        json={
            "expected_revision": final["revision"],
            "notes": "终态不应修改",
            "cat_status": None,
        },
    ).status_code == 409


def test_multi_task_order_progress_and_exception_terminal(
    task_api_context: TaskApiContext,
) -> None:
    client = task_api_context.client
    order = create_task_order(client, visits_per_day=2, service_items=["feed"])
    first_id, second_id = [task["id"] for task in order["tasks"]]

    first = complete_non_photo_items(client, start(client, first_id))
    first_completed = post_revision(client, first_id, "complete", first["revision"])
    assert first_completed.status_code == 200
    assert first_completed.json()["order_status"] == "in_progress"

    second = complete_non_photo_items(client, start(client, second_id))
    second_completed = post_revision(client, second_id, "complete", second["revision"])
    assert second_completed.status_code == 200
    assert second_completed.json()["order_status"] == "completed"

    exception_order = create_task_order(client, service_items=["feed"])
    exception_task = start(client, exception_order["tasks"][0]["id"])
    blank = client.post(
        f"/api/admin/tasks/{exception_task['id']}/exception",
        json={
            "expected_revision": exception_task["revision"],
            "exception_notes": "   ",
        },
    )
    assert blank.status_code == 422

    exception = client.post(
        f"/api/admin/tasks/{exception_task['id']}/exception",
        json={
            "expected_revision": exception_task["revision"],
            "exception_notes": "猫咪持续呕吐，已联系客户",
        },
    )
    assert exception.status_code == 200
    exceptional = exception.json()
    assert exceptional["status"] == "exception"
    assert exceptional["completed_at"] is not None
    assert exceptional["exception_notes"] == "猫咪持续呕吐，已联系客户"
    assert exceptional["order_status"] == "in_progress"
    assert post_revision(
        client,
        exceptional["id"],
        "complete",
        exceptional["revision"],
    ).status_code == 409


def test_upload_rejects_unsafe_or_invalid_images(
    task_api_context: TaskApiContext,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = task_api_context.client
    order = create_task_order(client, service_items=["feed"])
    detail = start(client, order["tasks"][0]["id"])
    url = f"/api/admin/tasks/{detail['id']}/photos"

    cases = [
        (("empty.png", b"", "image/png"), 422),
        (("script.svg", b"<svg><script>x</script></svg>", "image/svg+xml"), 422),
        (("fake.png", b"not an image", "image/png"), 422),
        (("wrong.jpg", image_bytes(), "image/jpeg"), 415),
        (("large.png", b"x" * (task_uploads.MAX_UPLOAD_BYTES + 1), "image/png"), 413),
    ]
    for file_tuple, expected_status in cases:
        response = client.post(
            url,
            data={"expected_revision": detail["revision"]},
            files={"photo": file_tuple},
        )
        assert response.status_code == expected_status
        assert not list(task_api_context.upload_root.rglob("*"))

    monkeypatch.setattr(task_uploads, "MAX_IMAGE_PIXELS", 1)
    too_many_pixels = client.post(
        url,
        data={"expected_revision": detail["revision"]},
        files={"photo": ("pixels.png", image_bytes(size=(2, 2)), "image/png")},
    )
    assert too_many_pixels.status_code == 413
    assert not list(task_api_context.upload_root.rglob("*"))


def test_upload_database_failure_removes_new_file(
    task_api_context: TaskApiContext,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = task_api_context.client
    order = create_task_order(client, service_items=["feed"])
    detail = start(client, order["tasks"][0]["id"])

    original_commit = Session.commit

    def fail_commit(_: Session):
        raise SQLAlchemyError("synthetic database failure")

    monkeypatch.setattr(Session, "commit", fail_commit)
    with pytest.raises(SQLAlchemyError, match="synthetic database failure"):
        client.post(
            f"/api/admin/tasks/{detail['id']}/photos",
            data={"expected_revision": detail["revision"]},
            files={"photo": ("test.png", image_bytes(), "image/png")},
        )
    monkeypatch.setattr(Session, "commit", original_commit)
    files = [path for path in task_api_context.upload_root.rglob("*") if path.is_file()]
    assert files == []
    with task_api_context.session_factory() as session:
        assert session.scalars(select(TaskPhoto)).all() == []


def test_missing_and_unstartable_tasks_return_clear_errors(
    task_api_context: TaskApiContext,
) -> None:
    client = task_api_context.client
    assert client.get("/api/admin/tasks/999999").status_code == 404
    order = create_task_order(client, service_items=["feed"])
    task_id = order["tasks"][0]["id"]
    detail = get_task(client, task_id)

    with task_api_context.session_factory.begin() as session:
        task = session.get(Task, task_id)
        assert task is not None
        task.status = TaskStatus.PENDING

    pending = get_task(client, task_id)
    assert post_revision(client, task_id, "start", pending["revision"]).status_code == 409

    another = create_task_order(client, service_items=["feed"])
    running = start(client, another["tasks"][0]["id"])
    wrong_item = client.patch(
        f"/api/admin/tasks/{running['id']}/items/999999",
        json={"expected_revision": running["revision"], "completed": True},
    )
    assert wrong_item.status_code == 404
