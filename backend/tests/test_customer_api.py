from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.db.session import build_engine, get_db
from app.main import app
from app.models import Cat, Customer


@pytest.fixture
def customer_api_client(migrated_database_url: str) -> Generator[TestClient, None, None]:
    engine = build_engine(migrated_database_url)
    testing_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db() -> Generator[Session, None, None]:
        with testing_session() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def create_customer(client: TestClient, *, name: str = "测试客户（虚构）") -> dict:
    response = client.post("/api/admin/customers", json={"name": name})
    assert response.status_code == 201
    return response.json()


def test_customer_and_multiple_cats_complete_workflow(
    customer_api_client: TestClient,
) -> None:
    client = customer_api_client
    create_response = client.post(
        "/api/admin/customers",
        json={
            "name": "  演示客户甲（虚构）  ",
            "wechat_name": "虚构微信名",
            "phone": "000-TEST-NUMBER",
            "community": "虚构小区",
            "address": "不对应任何真实地点",
            "building": "测试楼",
            "unit": "测试单元",
            "room": "测试房号",
            "access_method": "虚构门禁方式",
            "access_info": "虚构入户说明",
            "key_status": "未提供",
            "key_code": "TEST-KEY-NOT-REAL",
            "notes": "仅用于自动测试",
            "is_repeat_customer": True,
        },
    )
    assert create_response.status_code == 201
    customer = create_response.json()
    customer_id = customer["id"]
    assert customer["name"] == "演示客户甲（虚构）"
    assert customer["access_info"] == "虚构入户说明"
    assert customer["cats"] == []

    first_cat_response = client.post(
        f"/api/admin/customers/{customer_id}/cats",
        json={
            "name": "虚构猫咪奶糖",
            "photo_url": "/uploads/demo/not-a-real-photo.jpg",
            "gender": "female",
            "age": "2.5",
            "breed": "测试品种",
            "personality": "亲人",
            "food": "测试主食",
            "food_preference": "少量多餐",
            "litter_type": "豆腐砂",
            "medication_required": True,
            "medication_notes": "测试用药说明",
            "special_notes": "无真实医疗信息",
            "service_notes": "添粮、换水、清理猫砂",
        },
    )
    assert first_cat_response.status_code == 201
    first_cat = first_cat_response.json()

    second_cat_response = client.post(
        f"/api/admin/customers/{customer_id}/cats",
        json={
            "name": "虚构猫咪芝麻",
            "gender": "male",
            "age": 4,
            "service_notes": "陪玩、拍照",
        },
    )
    assert second_cat_response.status_code == 201
    second_cat = second_cat_response.json()

    detail_response = client.get(f"/api/admin/customers/{customer_id}")
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert [cat["name"] for cat in detail["cats"]] == [
        "虚构猫咪奶糖",
        "虚构猫咪芝麻",
    ]
    assert detail["cats"][0]["age"] == "2.5"
    assert detail["cats"][0]["medication_required"] is True

    update_response = client.patch(
        f"/api/admin/customers/{customer_id}",
        json={
            "name": "演示客户甲已编辑（虚构）",
            "access_info": "更新后的虚构入户说明",
            "key_code": "   ",
        },
    )
    assert update_response.status_code == 200
    assert update_response.json()["name"] == "演示客户甲已编辑（虚构）"
    assert update_response.json()["key_code"] is None

    edit_cat_response = client.patch(
        f"/api/admin/customers/{customer_id}/cats/{first_cat['id']}",
        json={"food_preference": "已编辑偏好", "is_active": False},
    )
    assert edit_cat_response.status_code == 200
    assert edit_cat_response.json()["food_preference"] == "已编辑偏好"
    assert edit_cat_response.json()["is_active"] is False

    list_response = client.get("/api/admin/customers")
    assert list_response.status_code == 200
    list_payload = list_response.json()
    assert list_payload["total"] == 1
    summary = list_payload["items"][0]
    assert summary["active_cat_count"] == 1
    assert summary["inactive_cat_count"] == 1
    assert set(summary) == {
        "id",
        "name",
        "wechat_name",
        "phone",
        "community",
        "is_repeat_customer",
        "active_cat_count",
        "inactive_cat_count",
        "pending_cat_profile_count",
        "archived_at",
        "updated_at",
    }
    assert "access_info" not in summary
    assert "key_code" not in summary
    assert "address" not in summary
    assert "notes" not in summary

    restore_response = client.patch(
        f"/api/admin/customers/{customer_id}/cats/{first_cat['id']}",
        json={"is_active": True},
    )
    assert restore_response.status_code == 200
    assert restore_response.json()["is_active"] is True

    assert second_cat["is_active"] is True


@pytest.mark.parametrize(
    "search_value",
    [
        "可搜索客户",
        "可搜索微信",
        "SEARCH-PHONE",
        "可搜索小区",
        "可搜索猫咪",
    ],
)
def test_customer_searches_supported_fields(
    customer_api_client: TestClient,
    search_value: str,
) -> None:
    client = customer_api_client
    customer_response = client.post(
        "/api/admin/customers",
        json={
            "name": "可搜索客户（虚构）",
            "wechat_name": "可搜索微信",
            "phone": "SEARCH-PHONE",
            "community": "可搜索小区",
        },
    )
    customer_id = customer_response.json()["id"]
    cat_response = client.post(
        f"/api/admin/customers/{customer_id}/cats",
        json={"name": "可搜索猫咪"},
    )
    assert cat_response.status_code == 201
    create_customer(client, name="不会命中的另一位虚构客户")

    response = client.post("/api/admin/customers/search", json={"search": search_value})

    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["id"] == customer_id


def test_customer_search_term_is_not_accepted_in_list_url(
    customer_api_client: TestClient,
) -> None:
    client = customer_api_client
    create_customer(client, name="不会通过 URL 搜索的虚构客户")
    create_customer(client, name="另一位虚构客户")

    response = client.get(
        "/api/admin/customers",
        params={"search": "不会通过 URL 搜索的虚构客户"},
    )

    assert response.status_code == 200
    assert response.json()["total"] == 2


def test_simplified_customer_patch_preserves_hidden_legacy_fields(
    customer_api_client: TestClient,
) -> None:
    client = customer_api_client
    created = client.post(
        "/api/admin/customers",
        json={
            "name": "保留旧字段客户（虚构）",
            "wechat_name": "旧微信",
            "phone": "OLD-PHONE",
            "community": "旧小区",
            "building": "旧楼栋",
            "unit": "旧单元",
            "room": "旧房号",
            "access_info": "旧入户信息",
            "address": None,
        },
    ).json()

    response = client.patch(
        f"/api/admin/customers/{created['id']}",
        json={
            "name": "保留旧字段客户已编辑（虚构）",
            "address": "新的单一完整地址",
            "access_method": "门卡",
            "key_status": "待取",
        },
    )

    assert response.status_code == 200
    updated = response.json()
    assert updated["address"] == "新的单一完整地址"
    assert updated["wechat_name"] == "旧微信"
    assert updated["phone"] == "OLD-PHONE"
    assert updated["community"] == "旧小区"
    assert updated["building"] == "旧楼栋"
    assert updated["unit"] == "旧单元"
    assert updated["room"] == "旧房号"
    assert updated["access_info"] == "旧入户信息"


def test_customer_api_validation_not_found_and_cat_ownership(
    customer_api_client: TestClient,
) -> None:
    client = customer_api_client
    first_customer = create_customer(client, name="第一位虚构客户")
    second_customer = create_customer(client, name="第二位虚构客户")
    cat_response = client.post(
        f"/api/admin/customers/{first_customer['id']}/cats",
        json={"name": "仅属于第一位客户的虚构猫咪"},
    )
    cat_id = cat_response.json()["id"]

    assert client.get("/api/admin/customers/999999").status_code == 404
    assert (
        client.post("/api/admin/customers/999999/cats", json={"name": "测试猫"}).status_code
        == 404
    )
    wrong_owner_response = client.patch(
        f"/api/admin/customers/{second_customer['id']}/cats/{cat_id}",
        json={"is_active": False},
    )
    assert wrong_owner_response.status_code == 404
    assert wrong_owner_response.json()["detail"] == "猫咪不存在或不属于该客户"

    assert client.post("/api/admin/customers", json={"name": "   "}).status_code == 422
    assert (
        client.post("/api/admin/customers/search", json={"search": "   "}).status_code
        == 422
    )
    assert (
        client.patch(
            f"/api/admin/customers/{first_customer['id']}",
            json={"name": None},
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"/api/admin/customers/{first_customer['id']}/cats",
            json={"name": "非法年龄测试猫", "age": -1},
        ).status_code
        == 422
    )
    assert (
        client.patch(
            f"/api/admin/customers/{first_customer['id']}/cats/{cat_id}",
            json={"is_active": None},
        ).status_code
        == 422
    )


def test_pure_customer_profile_delete_removes_its_unused_cats(
    customer_api_client: TestClient,
    migrated_database_url: str,
) -> None:
    client = customer_api_client
    customer = create_customer(client, name="可永久删除的纯档案（虚构）")
    cat = client.post(
        f"/api/admin/customers/{customer['id']}/cats",
        json={"name": "未被订单使用的虚构猫咪"},
    ).json()

    response = client.delete(f"/api/admin/customers/{customer['id']}")

    assert response.status_code == 204
    assert client.get(f"/api/admin/customers/{customer['id']}").status_code == 404
    verification_engine = build_engine(migrated_database_url)
    try:
        with Session(verification_engine) as session:
            assert session.scalar(select(func.count(Customer.id))) == 0
            assert session.scalar(select(func.count(Cat.id)).where(Cat.id == cat["id"])) == 0
    finally:
        verification_engine.dispose()


def test_customer_with_business_history_must_archive_and_order_snapshot_is_stable(
    customer_api_client: TestClient,
) -> None:
    client = customer_api_client
    customer = client.post(
        "/api/admin/customers",
        json={
            "name": "历史客户原名（虚构）",
            "phone": "TEST-HISTORY-PHONE",
            "address": "虚构路 88 号",
            "unit": "2 单元",
            "room": "1203",
        },
    ).json()
    cat = client.post(
        f"/api/admin/customers/{customer['id']}/cats",
        json={"name": "历史猫原名（虚构）", "service_notes": "旧订单照护说明"},
    ).json()
    order = client.post(
        "/api/admin/orders",
        json={
            "source_customer_id": customer["id"],
            "cat_count": 1,
            "service_dates": ["2033-01-02"],
            "service_items": ["feed", "photo"],
            "unit_price": "58.00",
        },
    ).json()
    assert order["service_contact"]["name"] == "历史客户原名（虚构）"
    assert order["cat_snapshot"][0]["name"] == "历史猫原名（虚构）"

    client.patch(
        f"/api/admin/customers/{customer['id']}",
        json={"name": "历史客户新名字（虚构）", "phone": "CHANGED-PHONE"},
    )
    client.patch(
        f"/api/admin/customers/{customer['id']}/cats/{cat['id']}",
        json={"name": "历史猫新名字（虚构）"},
    )
    delete_response = client.delete(f"/api/admin/customers/{customer['id']}")
    assert delete_response.status_code == 409
    assert "请改用归档" in delete_response.json()["detail"]

    archived = client.patch(
        f"/api/admin/customers/{customer['id']}/archive",
        json={"archived": True},
    )
    assert archived.status_code == 200
    assert archived.json()["archived_at"] is not None
    assert client.get("/api/admin/customers").json()["total"] == 0
    archived_list = client.get(
        "/api/admin/customers", params={"include_archived": "true"}
    ).json()
    assert archived_list["total"] == 1
    assert archived_list["items"][0]["id"] == customer["id"]

    preserved = client.get(f"/api/admin/orders/{order['id']}").json()
    assert preserved["service_contact"]["name"] == "历史客户原名（虚构）"
    assert preserved["service_contact"]["phone"] == "TEST-HISTORY-PHONE"
    assert preserved["cat_snapshot"][0]["name"] == "历史猫原名（虚构）"

    restored = client.patch(
        f"/api/admin/customers/{customer['id']}/archive",
        json={"archived": False},
    )
    assert restored.status_code == 200
    assert restored.json()["archived_at"] is None
    assert client.get("/api/admin/customers").json()["total"] == 1
