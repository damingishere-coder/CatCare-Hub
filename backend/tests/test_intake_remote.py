from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

from app.db.session import build_engine
from app.models import Customer, CustomerFormSubmission, Order
from app.models.enums import FormSubmissionStatus
from app.schemas.intake import (
    IntakeClaimRead,
    IntakeCompleteCommand,
    IntakeDecisionRead,
    IntakeDraftPayload,
    IntakeSubmissionDetail,
)
from app.services import intake_remote


class FakeRelayClient:
    def __init__(self, detail: IntakeSubmissionDetail) -> None:
        self.detail = detail
        self.claim_number = 0
        self.complete_number = 0

    def get_submission(self, submission_id: int) -> IntakeSubmissionDetail:
        assert submission_id == self.detail.id
        return self.detail

    def claim(
        self,
        submission_id: int,
        *,
        expected_revision: str,
        idempotency_key: str,
        decision_mode: str,
    ) -> IntakeClaimRead:
        assert submission_id == self.detail.id
        assert expected_revision == self.detail.revision
        self.claim_number += 1
        revision = f"{self.claim_number + 1:x}" * 64
        self.detail = self.detail.model_copy(
            update={
                "status": FormSubmissionStatus.PROCESSING,
                "decision_mode": decision_mode,
                "decision_idempotency_key": idempotency_key,
                "revision": revision[:64],
            }
        )
        return IntakeClaimRead(
            submission_id=submission_id,
            submission_uuid=self.detail.submission_uuid,
            status=FormSubmissionStatus.PROCESSING,
            decision_mode=decision_mode,
            claim_token=f"claim-token-{self.claim_number}-" + "x" * 32,
            revision=self.detail.revision,
        )

    def complete(
        self,
        submission_id: int,
        *,
        command: IntakeCompleteCommand,
    ) -> IntakeDecisionRead:
        self.complete_number += 1
        if self.complete_number == 1:
            raise HTTPException(status_code=503, detail="模拟云端回写失败")
        self.detail = self.detail.model_copy(
            update={
                "status": FormSubmissionStatus.ARCHIVED_CUSTOMER,
                "converted_customer_id": command.customer_id,
                "converted_order_id": None,
                "revision": "f" * 64,
            }
        )
        return IntakeDecisionRead(
            submission_id=submission_id,
            submission_uuid=self.detail.submission_uuid,
            status=FormSubmissionStatus.ARCHIVED_CUSTOMER,
            decision_mode="customer",
            customer_id=command.customer_id,
            order_id=None,
            revision=self.detail.revision,
        )


def test_remote_client_requires_https_except_for_loopback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CATCARE_INTAKE_RELAY_KEY", "relay-test-secret")
    monkeypatch.setenv("CATCARE_PUBLIC_FILL_ORIGIN", "https://fill.example.test")
    monkeypatch.setenv("CATCARE_INTAKE_RELAY_URL", "http://192.168.1.30:18081")

    with pytest.raises(HTTPException, match="必须使用 HTTPS"):
        intake_remote.RemoteIntakeClient()

    monkeypatch.setenv(
        "CATCARE_INTAKE_RELAY_URL",
        "https://nas-name.example.ts.net:8443/",
    )
    secure = intake_remote.RemoteIntakeClient()
    assert secure.base_url == "https://nas-name.example.ts.net:8443"

    monkeypatch.setenv("CATCARE_INTAKE_RELAY_URL", "http://127.0.0.1:18081/")
    loopback = intake_remote.RemoteIntakeClient()
    assert loopback.base_url == "http://127.0.0.1:18081"


def test_remote_client_connects_directly_with_broken_system_proxy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class RelayHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            if self.headers.get("Authorization") != "Bearer relay-test-secret":
                self.send_error(401)
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"items": [], "total": 0}')

        def log_message(self, format: str, *args: object) -> None:
            pass

    with ThreadingHTTPServer(("127.0.0.1", 0), RelayHandler) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            # A stale service-manager environment must not send Relay traffic
            # to a desktop proxy, even when NO_PROXY is absent or incorrect.
            for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"):
                monkeypatch.setenv(name, "http://127.0.0.1:1")
                monkeypatch.setenv(name.lower(), "http://127.0.0.1:1")
            monkeypatch.setenv("NO_PROXY", "")
            monkeypatch.setenv("no_proxy", "")
            monkeypatch.setenv(
                "CATCARE_INTAKE_RELAY_URL",
                f"http://127.0.0.1:{server.server_port}",
            )
            monkeypatch.setenv("CATCARE_INTAKE_RELAY_KEY", "relay-test-secret")
            monkeypatch.setenv("CATCARE_PUBLIC_FILL_ORIGIN", "https://fill.example.test")

            result = intake_remote.RemoteIntakeClient().list_tokens()
            assert result.items == []
            assert result.total == 0
        finally:
            server.shutdown()
            thread.join(timeout=5)


def test_remote_complete_failure_retry_returns_local_receipt_without_duplicates(
    migrated_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = datetime.now(timezone.utc)
    payload = IntakeDraftPayload.model_validate(
        {
            "customer": {
                "name": "远端重试测试客户",
                "phone": "TEST-CONTACT",
            },
            "cats": [],
            "service": {},
        }
    )
    detail = IntakeSubmissionDetail(
        id=71,
        submission_uuid="00000000-0000-4000-8000-000000000071",
        status=FormSubmissionStatus.REVIEWED,
        customer_name="远端重试测试客户",
        community=None,
        cat_count=0,
        start_date=None,
        end_date=None,
        submitted_at=now,
        updated_at=now,
        revision="a" * 64,
        payload=payload,
        review_payload=payload,
        review_unit_price=None,
        reviewed_at=now,
        converted_at=None,
        voided_at=None,
        purge_after=None,
        redacted_at=None,
        decision_mode=None,
        decision_idempotency_key=None,
        converted_customer_id=None,
        converted_order_id=None,
    )
    fake = FakeRelayClient(detail)
    monkeypatch.setattr(intake_remote, "RemoteIntakeClient", lambda: fake)

    engine = build_engine(migrated_database_url)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    key = "remote-customer-idempotency-0001"
    try:
        with factory() as session:
            with pytest.raises(HTTPException, match="模拟云端回写失败"):
                intake_remote.archive_remote_submission(
                    session,
                    remote_submission_id=71,
                    expected_revision="a" * 64,
                    idempotency_key=key,
                    decision_mode="customer",
                )

        with factory() as session:
            stored = session.scalar(
                select(CustomerFormSubmission).where(
                    CustomerFormSubmission.submission_uuid
                    == detail.submission_uuid
                )
            )
            assert stored is not None
            assert stored.status is FormSubmissionStatus.ARCHIVED_CUSTOMER
            local_customer_id = stored.converted_customer_id
            assert local_customer_id is not None
            assert session.scalar(select(func.count(Customer.id))) == 1
            assert session.scalar(select(func.count(Order.id))) == 0

        with factory() as session:
            result = intake_remote.archive_remote_submission(
                session,
                remote_submission_id=71,
                expected_revision=fake.detail.revision,
                idempotency_key=key,
                decision_mode="customer",
            )
            assert result.customer_id == local_customer_id

        with factory() as session:
            assert session.scalar(select(func.count(Customer.id))) == 1
            assert session.scalar(select(func.count(Order.id))) == 0
            assert session.scalar(select(func.count(CustomerFormSubmission.id))) == 1
    finally:
        engine.dispose()
