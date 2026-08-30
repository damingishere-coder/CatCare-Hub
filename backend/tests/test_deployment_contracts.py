from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _read(relative_path: str) -> str:
    return (PROJECT_ROOT / relative_path).read_text(encoding="utf-8")


def test_synology_relay_is_loopback_only_and_gateway_denies_admin_routes() -> None:
    compose = _read("deploy/synology/compose.yaml")
    gateway = _read("deploy/synology/gateway/nginx.conf")
    postgres_service = compose.split("  postgres:", 1)[1].split("\n  relay:", 1)[0]

    assert '"127.0.0.1:${CATCARE_RELAY_LAN_PORT:-18081}:8080"' in compose
    assert '"${CATCARE_NAS_LAN_IP}:${CATCARE_RELAY_LAN_PORT:-18081}:8080"' not in compose
    assert '"127.0.0.1:${CATCARE_FUNNEL_TARGET_PORT:-18080}:8080"' in compose
    assert "\n    ports:" not in postgres_service
    assert "location ^~ /api/admin/" in gateway
    assert "location ~ ^/(?:f|fill)/[A-Za-z0-9_-]+/?$" in gateway
    assert "location ~ ^/api/fill/[A-Za-z0-9_-]+(?:/submit)?$" in gateway


def test_public_hosting_docs_cover_current_and_compatibility_fill_paths() -> None:
    cloudbase = _read("deploy/cloudbase/README.md")
    synology = _read("deploy/synology/README.md")

    assert "/f/*" in cloudbase
    assert "/fill/*" in cloudbase
    assert "tailscale serve --https=8443 --bg http://127.0.0.1:18081" in synology
    assert "http://<NAS-LAN-IP>:18081" in synology
    assert "https://<NAS 的 tailnet DNS 名>:8443" in synology
