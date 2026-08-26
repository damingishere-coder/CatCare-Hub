from collections.abc import Generator
from dataclasses import dataclass
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.db.session import build_engine, get_db
from app.main import app
from app.models import Task, TaskPhoto


@dataclass(frozen=True)
class PlanApiContext:
    client: TestClient
    session_factory: sessionmaker[Session]


@pytest.fixture
def plan_api_context(
    migrated_database_url: str,
) -> Generator[PlanApiContext, None, None]:
    engine = build_engine(migrated_database_url)
    testing_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db() -> Generator[Session, None, None]:
        with testing_session() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            yield PlanApiContext(client=client, session_factory=testing_session)
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def create_customer_and_cats(
    client: TestClient,
    *,
    name: str,
    cat_names: tuple[str, ...],
) -> tuple[dict, list[dict]]:
    customer_response = client.post(
        "/api/admin/customers",
        json={
            "name": name,
            "phone": "000-PLAN-TEST",
            "community": "虚构计划小区",
            "address": "虚构路 100 号",
            "building": "3 栋",
            "unit": "2 单元",
            "room": "1602",
            "access_method": "虚构门禁方式",
            "access_info": "虚构入户信息",
            "key_status": "虚构钥匙状态",
            "key_code": "FAKE-KEY-CODE",
            "notes": "不应出现在 P4 任务响应中的虚构客户备注",
        },
    )
    assert customer_response.status_code == 201
    customer = customer_response.json()
    cats = []
    for index, cat_name in enumerate(cat_names):
        cat_response = client.post(
            f"/api/admin/customers/{customer['id']}/cats",
            json={
                "name": cat_name,
                "medication_required": index == 0,
                "medication_notes": "虚构用药说明" if index == 0 else None,
                "special_notes": "虚构特殊情况",
                "service_notes": "虚构服务注意事项",
            },
        )
        assert cat_response.status_code == 201
        cats.append(cat_response.json())
    return customer, cats


def create_order(
    client: TestClient,
    *,
    customer_id: int,
    cat_ids: list[int],
    start_date: str,
    end_date: str,
    visits_per_day: int,
) -> dict:
    response = client.post(
        "/api/admin/orders",
        json={
            "customer_id": customer_id,
            "cat_ids": cat_ids,
            "start_date": start_date,
            "end_date": end_date,
            "visits_per_day": visits_per_day,
            "service_items": ["feed", "water", "litter", "photo"],
            "base_price": "30.00",
            "stairs_fee": "0.00",
            "other_fee": "0.00",
            "order_status": "confirmed",
            "notes": "虚构 P4 订单备注",
        },
    )
    assert response.status_code == 201
    return response.json()


def create_three_task_plan(client: TestClient) -> tuple[dict, dict]:
    first_customer, first_cats = create_customer_and_cats(
        client,
        name="P4 第一位虚构客户",
        cat_names=("虚构猫甲", "虚构猫乙"),
    )
    second_customer, second_cats = create_customer_and_cats(
        client,
        name="P4 第二位虚构客户",
        cat_names=("虚构猫丙",),
    )
    first_order = create_order(
        client,
        customer_id=first_customer["id"],
        cat_ids=[cat["id"] for cat in first_cats],
        start_date="2033-10-01",
        end_date="2033-10-02",
        visits_per_day=2,
    )
    second_order = create_order(
        client,
        customer_id=second_customer["id"],
        cat_ids=[second_cats[0]["id"]],
        start_date="2033-10-01",
        end_date="2033-10-01",
        visits_per_day=1,
    )
    return first_order, second_order


def test_plan_days_and_task_detail_follow_privacy_boundaries(
    plan_api_context: PlanApiContext,
) -> None:
    client = plan_api_context.client
    create_three_task_plan(client)

    days_response = client.get("/api/admin/plans/days")
    assert days_response.status_code == 200
    assert days_response.json() == {
        "items": [
            {
                "service_date": "2033-10-01",
                "task_count": 3,
                "order_count": 2,
                "cat_count": 3,
                "customer_names": ["P4 第一位虚构客户", "P4 第二位虚构客户"],
            },
            {
                "service_date": "2033-10-02",
                "task_count": 2,
                "order_count": 1,
                "cat_count": 2,
                "customer_names": ["P4 第一位虚构客户"],
            },
        ],
        "total": 2,
    }

    day_response = client.get("/api/admin/plans/2033-10-01")
    assert day_response.status_code == 200
    day = day_response.json()
    assert day["task_count"] == 3
    assert day["order_count"] == 2
    assert day["cat_count"] == 3
    assert len(day["revision"]) == 64
    assert day["schedule_locked"] is False
    assert [task["sort_order"] for task in day["tasks"]] == [0, 0, 1]
    assert all(
        set(task["customer"]) == {"id", "name", "community", "address"}
        for task in day["tasks"]
    )
    assert all(task["customer"]["address"] for task in day["tasks"])
    serialized_day = day_response.text
    for forbidden in (
        "000-PLAN-TEST",
        "虚构门禁方式",
        "FAKE-KEY-CODE",
        "不应出现在 P4 任务响应中的虚构客户备注",
    ):
        assert forbidden not in serialized_day

    detail_response = client.get(f"/api/admin/plans/tasks/{day['tasks'][0]['id']}")
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert set(detail["customer"]) == {
        "id",
        "name",
        "community",
        "address",
        "building",
        "unit",
        "room",
    }
    assert detail["customer"]["address"] == "虚构路 100 号"
    assert detail["cats"][0]["service_notes"] == "虚构服务注意事项"
    assert detail["order_notes"] == "虚构 P4 订单备注"
    assert detail["photo_count"] == 0
    for forbidden_key in (
        "phone",
        "wechat_name",
        "access_method",
        "access_info",
        "key_status",
        "key_code",
        "notes",
        "file_url",
    ):
        assert forbidden_key not in detail["customer"]
        assert forbidden_key not in detail

    empty_response = client.get("/api/admin/plans/2033-10-03")
    assert empty_response.status_code == 200
    assert empty_response.json()["tasks"] == []
    assert empty_response.json()["task_count"] == 0
    assert client.get("/api/admin/plans/tasks/999999").status_code == 404


def test_schedule_save_is_atomic_persistent_and_revision_protected(
    plan_api_context: PlanApiContext,
) -> None:
    client = plan_api_context.client
    create_three_task_plan(client)
    initial = client.get("/api/admin/plans/2033-10-01").json()
    task_ids = [task["id"] for task in initial["tasks"]]
    reversed_ids = list(reversed(task_ids))

    schedule_payload = {
        "expected_revision": initial["revision"],
        "tasks": [
            {"task_id": reversed_ids[0], "planned_time": "10:40"},
            {"task_id": reversed_ids[1], "planned_time": None},
            {"task_id": reversed_ids[2], "planned_time": "09:30"},
        ],
    }
    saved_response = client.put(
        "/api/admin/plans/2033-10-01/schedule",
        json=schedule_payload,
    )
    assert saved_response.status_code == 200
    saved = saved_response.json()
    assert [task["id"] for task in saved["tasks"]] == reversed_ids
    assert [task["sort_order"] for task in saved["tasks"]] == [0, 1, 2]
    assert [task["planned_time"] for task in saved["tasks"]] == [
        "10:40:00",
        None,
        "09:30:00",
    ]
    assert saved["revision"] != initial["revision"]

    persisted = client.get("/api/admin/plans/2033-10-01").json()
    assert [task["id"] for task in persisted["tasks"]] == reversed_ids
    stale_response = client.put(
        "/api/admin/plans/2033-10-01/schedule",
        json=schedule_payload,
    )
    assert stale_response.status_code == 409
    assert client.get("/api/admin/plans/2033-10-01").json() == persisted

    duplicate_response = client.put(
        "/api/admin/plans/2033-10-01/schedule",
        json={
            "expected_revision": persisted["revision"],
            "tasks": [
                {"task_id": reversed_ids[0], "planned_time": None},
                {"task_id": reversed_ids[0], "planned_time": None},
                {"task_id": reversed_ids[2], "planned_time": None},
            ],
        },
    )
    assert duplicate_response.status_code == 422

    next_day_task_id = client.get("/api/admin/plans/2033-10-02").json()["tasks"][0]["id"]
    cross_day_response = client.put(
        "/api/admin/plans/2033-10-01/schedule",
        json={
            "expected_revision": persisted["revision"],
            "tasks": [
                {"task_id": reversed_ids[0], "planned_time": None},
                {"task_id": reversed_ids[1], "planned_time": None},
                {"task_id": next_day_task_id, "planned_time": None},
            ],
        },
    )
    assert cross_day_response.status_code == 409
    assert client.get("/api/admin/plans/2033-10-01").json() == persisted


def test_planning_status_and_execution_history_boundaries(
    plan_api_context: PlanApiContext,
) -> None:
    client = plan_api_context.client
    create_three_task_plan(client)
    day = client.get("/api/admin/plans/2033-10-01").json()
    first_task_id = day["tasks"][0]["id"]

    ready_response = client.patch(
        f"/api/admin/plans/tasks/{first_task_id}/status",
        json={
            "expected_revision": day["revision"],
            "task_status": "ready",
        },
    )
    assert ready_response.status_code == 200
    assert ready_response.json()["task"]["status"] == "ready"
    current = client.get("/api/admin/plans/2033-10-01").json()

    assert (
        client.patch(
            f"/api/admin/plans/tasks/{first_task_id}/status",
            json={
                "expected_revision": day["revision"],
                "task_status": "confirmed",
            },
        ).status_code
        == 409
    )
    execution_status_response = client.patch(
        f"/api/admin/plans/tasks/{first_task_id}/status",
        json={
            "expected_revision": current["revision"],
            "task_status": "in_progress",
        },
    )
    assert execution_status_response.status_code == 409

    with plan_api_context.session_factory.begin() as session:
        task = session.scalar(select(Task).where(Task.id == first_task_id))
        assert task is not None
        task.started_at = datetime(2033, 10, 1, 9, 30, tzinfo=timezone.utc)
        task.items[0].completed = True
        task.photos.append(TaskPhoto(file_url="/uploads/tests/fake-plan-photo.jpg"))

    locked = client.get("/api/admin/plans/2033-10-01").json()
    assert locked["schedule_locked"] is True
    locked_detail = client.get(f"/api/admin/plans/tasks/{first_task_id}").json()
    assert locked_detail["photo_count"] == 1
    assert "fake-plan-photo.jpg" not in str(locked_detail)

    locked_schedule_response = client.put(
        "/api/admin/plans/2033-10-01/schedule",
        json={
            "expected_revision": locked["revision"],
            "tasks": [
                {"task_id": task["id"], "planned_time": None}
                for task in locked["tasks"]
            ],
        },
    )
    assert locked_schedule_response.status_code == 409
    locked_status_response = client.patch(
        f"/api/admin/plans/tasks/{first_task_id}/status",
        json={
            "expected_revision": locked["revision"],
            "task_status": "confirmed",
        },
    )
    assert locked_status_response.status_code == 409


def test_cancelled_order_tasks_cannot_be_changed_individually(
    plan_api_context: PlanApiContext,
) -> None:
    client = plan_api_context.client
    first_order, _ = create_three_task_plan(client)
    cancel_response = client.patch(
        f"/api/admin/orders/{first_order['id']}/status",
        json={"order_status": "cancelled"},
    )
    assert cancel_response.status_code == 200

    day = client.get("/api/admin/plans/2033-10-02").json()
    task_id = day["tasks"][0]["id"]
    response = client.patch(
        f"/api/admin/plans/tasks/{task_id}/status",
        json={
            "expected_revision": day["revision"],
            "task_status": "ready",
        },
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "订单已取消或已完成，请先通过订单流程处理"
