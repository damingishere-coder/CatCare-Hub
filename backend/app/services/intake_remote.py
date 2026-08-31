import os
from urllib.parse import urljoin, urlsplit

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.enums import FormSubmissionStatus, FormTokenStatus
from app.models.intake import CustomerFormSubmission, CustomerFormToken
from app.schemas.intake import (
    IntakeClaimRead,
    IntakeCompleteCommand,
    IntakeDecisionRead,
    IntakeSubmissionDetail,
    IntakeSubmissionList,
    IntakeTokenList,
    IntakeTokenRead,
)
from app.services.credentials import token_digest
from app.services.intake import (
    archive_customer_submission,
    archive_order_submission,
    submission_revision,
    to_submission_detail,
    to_submission_summary,
    utc_now,
    void_submission,
)


RELAY_URL_ENV = "CATCARE_INTAKE_RELAY_URL"
RELAY_KEY_ENV = "CATCARE_INTAKE_RELAY_KEY"
PUBLIC_ORIGIN_ENV = "CATCARE_PUBLIC_FILL_ORIGIN"
RELAY_TIMEOUT_SECONDS = 12.0
RELAY_SERVER_ENV = "CATCARE_INTAKE_RELAY_SERVER"
LOOPBACK_RELAY_HOSTS = {"localhost", "127.0.0.1", "::1"}


def remote_intake_enabled() -> bool:
    return (
        os.getenv(RELAY_SERVER_ENV) != "1"
        and bool(os.getenv(RELAY_URL_ENV, "").strip())
    )


def _validated_relay_url(raw_url: str) -> str:
    value = raw_url.strip().rstrip("/")
    parsed = urlsplit(value)
    if (
        not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise HTTPException(status_code=503, detail="云端填写中转地址无效")
    if parsed.scheme == "https":
        return value
    if parsed.scheme == "http" and parsed.hostname.lower() in LOOPBACK_RELAY_HOSTS:
        return value
    raise HTTPException(
        status_code=503,
        detail="云端填写中转地址必须使用 HTTPS，明文 HTTP 仅允许本机回环",
    )


class RemoteIntakeClient:
    def __init__(self) -> None:
        raw_url = os.getenv(RELAY_URL_ENV, "")
        self.key = os.getenv(RELAY_KEY_ENV, "")
        self.public_origin = os.getenv(PUBLIC_ORIGIN_ENV, "").strip().rstrip("/")
        if not raw_url.strip():
            raise HTTPException(status_code=503, detail="云端填写中转地址未配置")
        self.base_url = _validated_relay_url(raw_url)
        if not self.key:
            raise HTTPException(status_code=503, detail="云端填写中转凭据未配置")
        if not self.public_origin:
            raise HTTPException(status_code=503, detail="微信填写页公网地址未配置")

    def _request(
        self,
        method: str,
        path: str,
        *,
        payload: dict[str, object] | None = None,
    ) -> object:
        try:
            response = httpx.request(
                method,
                f"{self.base_url}{path}",
                headers={"Authorization": f"Bearer {self.key}"},
                json=payload,
                timeout=RELAY_TIMEOUT_SECONDS,
            )
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=503,
                detail="云端客户资料暂不可用，请稍后重试",
            ) from exc
        if response.status_code >= 400:
            try:
                detail = response.json().get("detail")
            except (ValueError, AttributeError):
                detail = None
            safe_detail = (
                detail
                if isinstance(detail, str) and len(detail) <= 200
                else "云端客户资料操作失败"
            )
            raise HTTPException(status_code=response.status_code, detail=safe_detail)
        try:
            return response.json()
        except ValueError as exc:
            raise HTTPException(status_code=502, detail="云端中转返回了无效数据") from exc

    def _token(self, data: object) -> IntakeTokenRead:
        token = IntakeTokenRead.model_validate(data)
        if token.fill_path:
            token = token.model_copy(
                update={
                    "fill_path": urljoin(
                        f"{self.public_origin}/",
                        token.fill_path.lstrip("/"),
                    )
                }
            )
        return token

    def list_tokens(self) -> IntakeTokenList:
        data = IntakeTokenList.model_validate(
            self._request("GET", "/api/admin/intake/tokens")
        )
        return data.model_copy(update={"items": [self._token(item) for item in data.items]})

    def create_token(self, *, expires_in_days: int) -> IntakeTokenRead:
        return self._token(
            self._request(
                "POST",
                "/api/admin/intake/tokens",
                payload={"expires_in_days": expires_in_days},
            )
        )

    def update_token(
        self,
        token_id: int,
        *,
        status: str,
        expected_revision: str,
    ) -> IntakeTokenRead:
        return self._token(
            self._request(
                "PATCH",
                f"/api/admin/intake/tokens/{token_id}",
                payload={
                    "status": status,
                    "expected_revision": expected_revision,
                },
            )
        )

    def list_submissions(
        self,
        *,
        limit: int = 100,
        offset: int = 0,
    ) -> IntakeSubmissionList:
        return IntakeSubmissionList.model_validate(
            self._request(
                "GET",
                f"/api/admin/intake/submissions?limit={limit}&offset={offset}",
            )
        )

    def get_submission(self, submission_id: int) -> IntakeSubmissionDetail:
        return IntakeSubmissionDetail.model_validate(
            self._request("GET", f"/api/admin/intake/submissions/{submission_id}")
        )

    def save_review(
        self,
        submission_id: int,
        *,
        review_payload: dict[str, object],
        unit_price: str | None,
        expected_revision: str,
    ) -> IntakeSubmissionDetail:
        return IntakeSubmissionDetail.model_validate(
            self._request(
                "PUT",
                f"/api/admin/intake/submissions/{submission_id}/review-draft",
                payload={
                    "review_payload": review_payload,
                    "unit_price": unit_price,
                    "expected_revision": expected_revision,
                },
            )
        )

    def claim(
        self,
        submission_id: int,
        *,
        expected_revision: str,
        idempotency_key: str,
        decision_mode: str,
    ) -> IntakeClaimRead:
        return IntakeClaimRead.model_validate(
            self._request(
                "POST",
                f"/api/admin/intake/submissions/{submission_id}/claim",
                payload={
                    "expected_revision": expected_revision,
                    "idempotency_key": idempotency_key,
                    "decision_mode": decision_mode,
                },
            )
        )

    def complete(
        self,
        submission_id: int,
        *,
        command: IntakeCompleteCommand,
    ) -> IntakeDecisionRead:
        return IntakeDecisionRead.model_validate(
            self._request(
                "POST",
                f"/api/admin/intake/submissions/{submission_id}/complete",
                payload=command.model_dump(mode="json"),
            )
        )


def _terminal_decision(detail: IntakeSubmissionDetail) -> IntakeDecisionRead:
    mode = detail.decision_mode or (
        "order" if detail.status is FormSubmissionStatus.CONVERTED else None
    )
    if mode not in {"customer", "order", "void"}:
        raise HTTPException(status_code=409, detail="云端归档回执不完整")
    return IntakeDecisionRead(
        submission_id=detail.id,
        submission_uuid=detail.submission_uuid,
        status=detail.status,
        decision_mode=mode,
        customer_id=detail.converted_customer_id,
        order_id=detail.converted_order_id,
        revision=detail.revision,
    )


def _local_mirror(
    session: Session,
    detail: IntakeSubmissionDetail,
) -> CustomerFormSubmission:
    existing = session.scalar(
        select(CustomerFormSubmission).where(
            CustomerFormSubmission.submission_uuid == detail.submission_uuid
        )
    )
    terminal = {
        FormSubmissionStatus.ARCHIVED_CUSTOMER,
        FormSubmissionStatus.ARCHIVED_ORDER,
        FormSubmissionStatus.VOIDED,
        FormSubmissionStatus.CONVERTED,
    }
    if existing is not None:
        if existing.status not in terminal:
            existing.payload = detail.payload.model_dump(mode="json")
            existing.review_payload = (
                detail.review_payload.model_dump(mode="json")
                if detail.review_payload
                else None
            )
            existing.review_unit_price = detail.review_unit_price
            existing.status = FormSubmissionStatus.REVIEWED
            existing.revision_number += 1
        return existing

    now = utc_now()
    token = CustomerFormToken(
        token_hash=token_digest(f"relay:{detail.submission_uuid}"),
        status=FormTokenStatus.DISABLED,
        expires_at=now,
        submitted_at=detail.submitted_at or now,
    )
    submission = CustomerFormSubmission(
        token=token,
        submission_uuid=detail.submission_uuid,
        payload=detail.payload.model_dump(mode="json"),
        review_payload=(
            detail.review_payload.model_dump(mode="json")
            if detail.review_payload
            else None
        ),
        review_unit_price=detail.review_unit_price,
        status=FormSubmissionStatus.REVIEWED,
        revision_number=1,
        reviewed_at=detail.reviewed_at or now,
    )
    session.add(submission)
    session.flush()
    return submission


def hydrate_remote_list(
    session: Session,
    remote_list: IntakeSubmissionList,
) -> IntakeSubmissionList:
    uuids = [item.submission_uuid for item in remote_list.items]
    if not uuids:
        return remote_list
    local_by_uuid = {
        item.submission_uuid: item
        for item in session.scalars(
            select(CustomerFormSubmission).where(
                CustomerFormSubmission.submission_uuid.in_(uuids)
            )
        ).all()
    }
    hydrated = []
    for remote in remote_list.items:
        local = local_by_uuid.get(remote.submission_uuid)
        if local is None:
            hydrated.append(remote)
            continue
        local_summary = to_submission_summary(local)
        hydrated.append(
            local_summary.model_copy(
                update={
                    "id": remote.id,
                    "status": remote.status,
                    "submitted_at": remote.submitted_at,
                    "updated_at": remote.updated_at,
                    "revision": remote.revision,
                }
            )
        )
    return IntakeSubmissionList(items=hydrated, total=remote_list.total)


def hydrate_remote_detail(
    session: Session,
    remote: IntakeSubmissionDetail,
) -> IntakeSubmissionDetail:
    local = session.scalar(
        select(CustomerFormSubmission).where(
            CustomerFormSubmission.submission_uuid == remote.submission_uuid
        )
    )
    if local is None:
        return remote
    local_detail = to_submission_detail(local)
    return local_detail.model_copy(
        update={
            "id": remote.id,
            "status": remote.status,
            "submitted_at": remote.submitted_at,
            "updated_at": remote.updated_at,
            "revision": remote.revision,
            "purge_after": remote.purge_after,
            "redacted_at": remote.redacted_at,
            "decision_mode": remote.decision_mode or local_detail.decision_mode,
            "decision_idempotency_key": (
                remote.decision_idempotency_key
                or local_detail.decision_idempotency_key
            ),
        }
    )


def archive_remote_submission(
    session: Session,
    *,
    remote_submission_id: int,
    expected_revision: str,
    idempotency_key: str,
    decision_mode: str,
) -> IntakeDecisionRead:
    client = RemoteIntakeClient()
    remote_detail = client.get_submission(remote_submission_id)
    existing = session.scalar(
        select(CustomerFormSubmission).where(
            CustomerFormSubmission.submission_uuid == remote_detail.submission_uuid
        )
    )
    terminal_statuses = {
        FormSubmissionStatus.ARCHIVED_CUSTOMER,
        FormSubmissionStatus.ARCHIVED_ORDER,
        FormSubmissionStatus.VOIDED,
        FormSubmissionStatus.CONVERTED,
    }
    if existing is None or existing.status not in terminal_statuses:
        if remote_detail.revision != expected_revision:
            raise HTTPException(status_code=409, detail="云端提交已变化，请刷新后重试")
    effective_key = (
        existing.idempotency_key
        if existing is not None and existing.idempotency_key
        else idempotency_key
    )
    claim = client.claim(
        remote_submission_id,
        expected_revision=remote_detail.revision,
        idempotency_key=effective_key,
        decision_mode=decision_mode,
    )
    if claim.claim_token is None:
        return _terminal_decision(client.get_submission(remote_submission_id))

    remote_detail = client.get_submission(remote_submission_id)
    local_submission = _local_mirror(session, remote_detail)
    local_revision = submission_revision(local_submission)
    try:
        if decision_mode == "customer":
            local_result = archive_customer_submission(
                session,
                local_submission,
                expected_revision=local_revision,
                idempotency_key=effective_key,
            )
        elif decision_mode == "order":
            local_result = archive_order_submission(
                session,
                local_submission,
                expected_revision=local_revision,
                idempotency_key=effective_key,
            )
        elif decision_mode == "void":
            local_result = void_submission(
                session,
                local_submission,
                expected_revision=local_revision,
                idempotency_key=effective_key,
            )
        else:
            raise HTTPException(status_code=422, detail="未知审核动作")
        session.commit()
    except Exception:
        session.rollback()
        raise

    command = IntakeCompleteCommand(
        claim_token=claim.claim_token,
        idempotency_key=effective_key,
        decision_mode=decision_mode,
        customer_id=local_result.customer_id,
        order_id=local_result.order_id,
    )
    return client.complete(remote_submission_id, command=command)
