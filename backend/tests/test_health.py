from fastapi.testclient import TestClient

from backend.app.main import app


client = TestClient(app)


def test_health_check_reports_ready() -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "catcare-hub-api",
    }
