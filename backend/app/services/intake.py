import hashlib
import json
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.models.customer import Cat, Customer
from app.models.enums import FormSubmissionStatus, FormTokenStatus, OrderStatus
from app.models.intake import (
    CustomerFormSubmission,
    CustomerFormToken,
    IntakeAuditEvent,
)
from app.schemas.customer import CatCreate, CustomerCreate
from app.schemas.intake import (
    IntakeClaimRead,
    IntakeAuditEventRead,
    IntakeCompleteCommand,
    IntakeConversionRead,
    IntakeDecisionRead,
    IntakeDraftPayload,
    IntakeOrderArchivePayload,
    PublicIntakeDraftPayload,
    IntakeSubmissionDetail,
    IntakeSubmissionPayload,
    IntakeSubmissionSummary,
    IntakeTokenRead,
    PublicIntakeRead,
    PublicIntakeSubmissionPayload,
)
from app.schemas.order import OrderWrite
from app.services.business_time import as_utc
from app.services.credentials import token_digest
from app.services.customers import build_customer
from app.services.orders import build_order, reprice_order


TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{40,128}$")
TOKEN_GENERATION_ATTEMPTS = 5
CLAIM_TTL = timedelta(minutes=5)
RELAY_RETENTION = timedelta(days=30)
RELAY_SERVER_ENV = "CATCARE_INTAKE_RELAY_SERVER"


def record_intake_audit_event(
    session: Session,
    *,
    event_type: str,
    actor: str,
    token: CustomerFormToken | None = None,
    submission: CustomerFormSubmission | None = None,
    decision_mode: str | None = None,
    details: dict[str, int | str | bool | None] | None = None,
) -> IntakeAuditEvent:
    if token is None and submission is None:
        raise ValueError("intake audit event requires a token or submission")
    event = IntakeAuditEvent(
        token=token,
        submission=submission,
        event_type=event_type,
        actor=actor,
        revision_number=(submission.revision_number if submission else None),
        decision_mode=decision_mode,
        details=details or {},
    )
    session.add(event)
    return event


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime | None) -> str | None:
    normalized = as_utc(value)
    return normalized.isoformat() if normalized else None


def _revision(parts: dict[str, object]) -> str:
    encoded = json.dumps(
        parts,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
        default=str,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _payload_hash(payload: object) -> str:
    if hasattr(payload, "model_dump"):
        payload = payload.model_dump(mode="json")
    return _revision({"payload": payload})


def token_revision(token: CustomerFormToken) -> str:
    submission = token.submissions[0] if token.submissions else None
    return _revision(
        {
            "id": token.id,
            "status": token.status.value,
            "expires_at": _iso(token.expires_at),
            "submitted_at": _iso(token.submitted_at),
            "updated_at": _iso(token.updated_at),
            "submission_status": submission.status.value if submission else None,
        }
    )


def submission_revision(submission: CustomerFormSubmission) -> str:
    return _revision(
        {
            "id": submission.id,
            "submission_uuid": submission.submission_uuid,
            "revision_number": submission.revision_number,
            "status": submission.status.value,
            "payload": submission.payload,
            "review_payload": submission.review_payload,
            "review_unit_price": submission.review_unit_price,
            "reviewed_at": _iso(submission.reviewed_at),
            "converted_at": _iso(submission.converted_at),
            "voided_at": _iso(submission.voided_at),
            "purge_after": _iso(submission.purge_after),
            "redacted_at": _iso(submission.redacted_at),
            "decision_mode": submission.decision_mode,
            "idempotency_key": submission.idempotency_key,
            "converted_customer_id": submission.converted_customer_id,
            "converted_order_id": submission.converted_order_id,
            "receipt_customer_id": submission.receipt_customer_id,
            "receipt_order_id": submission.receipt_order_id,
            "updated_at": _iso(submission.updated_at),
        }
    )


def _submission_for(token: CustomerFormToken) -> CustomerFormSubmission | None:
    return token.submissions[0] if token.submissions else None


def _expire_token(token: CustomerFormToken, *, now: datetime) -> bool:
    if token.submitted_at is not None:
        return False
    expires_at = as_utc(token.expires_at)
    if token.status is FormTokenStatus.EXPIRED:
        return False
    if expires_at is not None and expires_at > now:
        return False
    token.status = FormTokenStatus.EXPIRED
    submission = _submission_for(token)
    if submission and submission.status is FormSubmissionStatus.DRAFT:
        submission.status = FormSubmissionStatus.EXPIRED
    return True


def _token_statement():
    return select(CustomerFormToken).options(
        selectinload(CustomerFormToken.submissions)
    )


def load_public_token(
    session: Session,
    raw_token: str,
    *,
    now: datetime | None = None,
) -> CustomerFormToken:
    if not TOKEN_PATTERN.fullmatch(raw_token):
        raise HTTPException(status_code=404, detail="填写链接无效")
    token = session.scalar(
        _token_statement().where(CustomerFormToken.token_hash == token_digest(raw_token))
    )
    if token is None:
        raise HTTPException(status_code=404, detail="填写链接无效")

    _expire_token(token, now=now or utc_now())
    if token.status is FormTokenStatus.EXPIRED:
        raise HTTPException(status_code=410, detail="填写链接已过期")
    if token.status is FormTokenStatus.DISABLED:
        raise HTTPException(status_code=410, detail="填写链接已关闭")
    return token


def public_read(token: CustomerFormToken) -> PublicIntakeRead:
    submission = _submission_for(token)
    if submission is None or submission.status is FormSubmissionStatus.DRAFT:
        draft = _public_payload_from_stored(submission.payload if submission else {})
        return PublicIntakeRead(
            status="editable",
            expires_at=token.expires_at,
            draft=draft,
            revision=(
                submission_revision(submission)
                if submission is not None
                else token_revision(token)
            ),
        )
    status_map = {
        FormSubmissionStatus.SUBMITTED: "submitted",
        FormSubmissionStatus.REVIEWED: "reviewed",
        FormSubmissionStatus.PROCESSING: "reviewed",
        FormSubmissionStatus.ARCHIVED_CUSTOMER: "archived",
        FormSubmissionStatus.ARCHIVED_ORDER: "archived",
        FormSubmissionStatus.CONVERTED: "archived",
        FormSubmissionStatus.VOIDED: "voided",
    }
    if submission.status is FormSubmissionStatus.REDACTED:
        state = "voided" if submission.decision_mode == "void" else "archived"
        return PublicIntakeRead(status=state, expires_at=token.expires_at)
    state = status_map.get(submission.status)
    if state is None:
        raise HTTPException(status_code=410, detail="填写链接已过期")
    return PublicIntakeRead(status=state, expires_at=token.expires_at)


def _stored_payload_from_public(
    payload: PublicIntakeDraftPayload | PublicIntakeSubmissionPayload,
) -> IntakeDraftPayload:
    public_data = payload.model_dump(mode="json")
    return IntakeDraftPayload.model_validate(
        {
            "customer": public_data["customer"],
            "cats": public_data["cats"],
            "service": {
                **public_data["service"],
                "service_items": [],
            },
            "notes": public_data["notes"],
        }
    )


def _public_payload_from_stored(payload: dict[str, object]) -> PublicIntakeDraftPayload:
    stored = IntakeDraftPayload.model_validate(payload or {})
    return PublicIntakeDraftPayload.model_validate(
        {
            "customer": {
                field: getattr(stored.customer, field)
                for field in (
                    "name",
                    "wechat_name",
                    "phone",
                    "address",
                    "access_method",
                    "key_status",
                    "notes",
                )
            },
            "cats": [
                {
                    field: getattr(cat, field)
                    for field in (
                        "name",
                        "food",
                        "litter_type",
                        "medication_required",
                        "medication_notes",
                        "special_notes",
                    )
                }
                for cat in stored.cats
            ],
            "service": {
                "start_date": stored.service.start_date,
                "end_date": stored.service.end_date,
                "visits_per_day": stored.service.visits_per_day,
            },
            "notes": stored.notes,
        }
    )


def save_draft(
    session: Session,
    token: CustomerFormToken,
    payload: PublicIntakeDraftPayload,
    *,
    expected_revision: str,
    now: datetime | None = None,
) -> CustomerFormSubmission:
    submission = _submission_for(token)
    if token.submitted_at is not None or (
        submission is not None and submission.status is not FormSubmissionStatus.DRAFT
    ):
        raise HTTPException(status_code=409, detail="表单已提交，不能继续修改")
    current_revision = (
        submission_revision(submission) if submission is not None else token_revision(token)
    )
    if current_revision != expected_revision:
        raise HTTPException(status_code=409, detail="表单已被其他页面更新，请刷新后重试")
    changed_at = now or utc_now()
    stored_payload = _stored_payload_from_public(payload)
    if submission is None:
        submission = CustomerFormSubmission(
            token=token,
            payload=stored_payload.model_dump(mode="json"),
            revision_number=1,
        )
        session.add(submission)
        session.flush()
    else:
        result = session.execute(
            update(CustomerFormSubmission)
            .where(
                CustomerFormSubmission.id == submission.id,
                CustomerFormSubmission.status == FormSubmissionStatus.DRAFT,
                CustomerFormSubmission.revision_number == submission.revision_number,
            )
            .values(
                payload=stored_payload.model_dump(mode="json"),
                revision_number=submission.revision_number + 1,
                updated_at=changed_at,
            )
            .execution_options(synchronize_session=False)
        )
        if result.rowcount != 1:
            raise HTTPException(status_code=409, detail="表单已被其他页面更新，请刷新后重试")
        session.expire(submission)
    record_intake_audit_event(
        session,
        event_type="draft_saved",
        actor="customer",
        submission=submission,
    )
    return submission


def submit_form(
    session: Session,
    token: CustomerFormToken,
    payload: PublicIntakeSubmissionPayload,
    *,
    expected_revision: str,
    idempotency_key: str,
    now: datetime | None = None,
) -> CustomerFormSubmission:
    submission = _submission_for(token)
    payload_hash = _payload_hash(payload)
    if (
        submission is not None
        and submission.submit_idempotency_key == idempotency_key
        and submission.status is not FormSubmissionStatus.DRAFT
    ):
        if submission.submit_payload_hash != payload_hash:
            raise HTTPException(status_code=409, detail="同一提交请求的内容不一致")
        return submission
    if token.submitted_at is not None or (
        submission is not None and submission.status is not FormSubmissionStatus.DRAFT
    ):
        raise HTTPException(status_code=409, detail="表单已经提交")
    current_revision = (
        submission_revision(submission) if submission is not None else token_revision(token)
    )
    if current_revision != expected_revision:
        raise HTTPException(status_code=409, detail="表单已被其他页面更新，请刷新后重试")
    changed_at = now or utc_now()
    stored_payload = _stored_payload_from_public(payload)
    if submission is None:
        submission = CustomerFormSubmission(
            token=token,
            payload=stored_payload.model_dump(mode="json"),
            status=FormSubmissionStatus.SUBMITTED,
            revision_number=1,
            submit_idempotency_key=idempotency_key,
            submit_payload_hash=payload_hash,
        )
        session.add(submission)
        session.flush()
    else:
        result = session.execute(
            update(CustomerFormSubmission)
            .where(
                CustomerFormSubmission.id == submission.id,
                CustomerFormSubmission.status == FormSubmissionStatus.DRAFT,
                CustomerFormSubmission.revision_number == submission.revision_number,
            )
            .values(
                payload=stored_payload.model_dump(mode="json"),
                status=FormSubmissionStatus.SUBMITTED,
                revision_number=submission.revision_number + 1,
                submit_idempotency_key=idempotency_key,
                submit_payload_hash=payload_hash,
                updated_at=changed_at,
            )
            .execution_options(synchronize_session=False)
        )
        if result.rowcount != 1:
            raise HTTPException(status_code=409, detail="表单已被其他页面更新，请刷新后重试")
        session.expire(submission)
    token.submitted_at = changed_at
    record_intake_audit_event(
        session,
        event_type="submitted",
        actor="customer",
        submission=submission,
    )
    return submission


def create_token(
    session: Session,
    *,
    expires_in_days: int,
    now: datetime | None = None,
) -> tuple[CustomerFormToken, str]:
    created_at = now or utc_now()
    for _ in range(TOKEN_GENERATION_ATTEMPTS):
        raw_token = secrets.token_urlsafe(32)
        token = CustomerFormToken(
            token_hash=token_digest(raw_token),
            expires_at=created_at + timedelta(days=expires_in_days),
        )
        try:
            with session.begin_nested():
                session.add(token)
                session.flush()
            record_intake_audit_event(
                session,
                event_type="link_created",
                actor="admin",
                token=token,
                details={"expires_in_days": expires_in_days},
            )
            return token, raw_token
        except IntegrityError:
            continue
    raise HTTPException(status_code=503, detail="暂时无法生成填写链接，请重试")


def expire_loaded_tokens(
    tokens: list[CustomerFormToken],
    *,
    now: datetime | None = None,
) -> bool:
    check_time = now or utc_now()
    changed = False
    for token in tokens:
        changed = _expire_token(token, now=check_time) or changed
    return changed


def to_token_read(
    token: CustomerFormToken,
    *,
    raw_token: str | None = None,
) -> IntakeTokenRead:
    submission = _submission_for(token)
    return IntakeTokenRead(
        id=token.id,
        status=token.status,
        expires_at=token.expires_at,
        submitted_at=token.submitted_at,
        fill_path=f"/fill/{raw_token}" if raw_token else None,
        submission_status=submission.status if submission else None,
        revision=token_revision(token),
        created_at=token.created_at,
    )


def update_token_status(
    session: Session,
    token: CustomerFormToken,
    *,
    target: FormTokenStatus,
    expected_revision: str,
    now: datetime | None = None,
) -> None:
    _expire_token(token, now=now or utc_now())
    if token_revision(token) != expected_revision:
        raise HTTPException(status_code=409, detail="填写链接状态已变化，请刷新后重试")
    if token.status is FormTokenStatus.EXPIRED:
        raise HTTPException(status_code=409, detail="已过期的填写链接不能恢复")
    if token.submitted_at is not None:
        raise HTTPException(status_code=409, detail="已提交的填写链接不能修改状态")
    token.status = target
    record_intake_audit_event(
        session,
        event_type=("link_disabled" if target is FormTokenStatus.DISABLED else "link_enabled"),
        actor="admin",
        token=token,
    )


def _safe_draft(payload: dict[str, object]) -> IntakeDraftPayload:
    try:
        return IntakeDraftPayload.model_validate(payload)
    except ValidationError as exc:
        raise HTTPException(status_code=409, detail="历史表单数据无效，无法读取") from exc


def to_submission_summary(
    submission: CustomerFormSubmission,
) -> IntakeSubmissionSummary:
    if submission.status is FormSubmissionStatus.REDACTED:
        return IntakeSubmissionSummary(
            id=submission.id,
            submission_uuid=submission.submission_uuid,
            status=submission.status,
            customer_name=None,
            community=None,
            cat_count=0,
            start_date=None,
            end_date=None,
            submitted_at=submission.token.submitted_at,
            updated_at=submission.updated_at,
            revision=submission_revision(submission),
        )
    payload = _safe_draft(submission.review_payload or submission.payload)
    return IntakeSubmissionSummary(
        id=submission.id,
        submission_uuid=submission.submission_uuid,
        status=submission.status,
        customer_name=payload.customer.name,
        community=payload.customer.community,
        cat_count=len(payload.cats),
        start_date=payload.service.start_date,
        end_date=payload.service.end_date,
        submitted_at=submission.token.submitted_at,
        updated_at=submission.updated_at,
        revision=submission_revision(submission),
    )


def to_submission_detail(
    submission: CustomerFormSubmission,
) -> IntakeSubmissionDetail:
    summary = to_submission_summary(submission)
    return IntakeSubmissionDetail(
        **summary.model_dump(),
        payload=(
            IntakeDraftPayload()
            if submission.status is FormSubmissionStatus.REDACTED
            else _safe_draft(submission.payload)
        ),
        review_payload=(
            IntakeDraftPayload.model_validate(submission.review_payload)
            if submission.review_payload is not None
            else None
        ),
        review_unit_price=submission.review_unit_price,
        reviewed_at=submission.reviewed_at,
        converted_at=submission.converted_at,
        voided_at=submission.voided_at,
        purge_after=submission.purge_after,
        redacted_at=submission.redacted_at,
        decision_mode=submission.decision_mode,
        decision_idempotency_key=submission.idempotency_key,
        converted_customer_id=(
            submission.receipt_customer_id or submission.converted_customer_id
        ),
        converted_order_id=(
            submission.receipt_order_id or submission.converted_order_id
        ),
        audit_events=[
            IntakeAuditEventRead(
                id=event.id,
                event_type=event.event_type,
                actor=event.actor,
                revision_number=event.revision_number,
                decision_mode=event.decision_mode,
                details=event.details,
                created_at=event.created_at,
            )
            for event in submission.audit_events
        ],
    )


def save_review_draft(
    session: Session,
    submission: CustomerFormSubmission,
    *,
    review_payload: IntakeDraftPayload,
    unit_price: Decimal | None,
    expected_revision: str,
    now: datetime | None = None,
) -> None:
    if submission_revision(submission) != expected_revision:
        raise HTTPException(status_code=409, detail="提交记录已变化，请刷新后重试")
    if submission.status in {
        FormSubmissionStatus.PROCESSING,
        FormSubmissionStatus.ARCHIVED_CUSTOMER,
        FormSubmissionStatus.ARCHIVED_ORDER,
        FormSubmissionStatus.VOIDED,
        FormSubmissionStatus.REDACTED,
        FormSubmissionStatus.CONVERTED,
    }:
        raise HTTPException(status_code=409, detail="已落档记录不能再次编辑")
    if submission.status not in {
        FormSubmissionStatus.SUBMITTED,
        FormSubmissionStatus.REVIEWED,
    }:
        raise HTTPException(status_code=409, detail="当前提交状态不能编辑审核稿")
    changed_at = now or utc_now()
    revision_number = submission.revision_number
    statement = (
        update(CustomerFormSubmission)
        .where(
            CustomerFormSubmission.id == submission.id,
            CustomerFormSubmission.status.in_(
                [FormSubmissionStatus.SUBMITTED, FormSubmissionStatus.REVIEWED]
            ),
            CustomerFormSubmission.revision_number == revision_number,
        )
        .values(
            review_payload=review_payload.model_dump(mode="json"),
            review_unit_price=unit_price,
            status=FormSubmissionStatus.REVIEWED,
            reviewed_at=submission.reviewed_at or changed_at,
            revision_number=revision_number + 1,
            updated_at=changed_at,
        )
        .execution_options(synchronize_session=False)
    )
    session_result = session.execute(statement)
    if session_result.rowcount != 1:
        raise HTTPException(status_code=409, detail="提交记录已被其他操作更新")
    session.expire(submission)
    record_intake_audit_event(
        session,
        event_type="review_saved",
        actor="admin",
        submission=submission,
        details={"unit_price_set": unit_price is not None},
    )


def mark_reviewed(
    session: Session,
    submission: CustomerFormSubmission,
    *,
    expected_revision: str,
    now: datetime | None = None,
) -> None:
    if submission_revision(submission) != expected_revision:
        raise HTTPException(status_code=409, detail="提交记录已变化，请刷新后重试")
    if submission.status is FormSubmissionStatus.REVIEWED:
        return
    if submission.status is not FormSubmissionStatus.SUBMITTED:
        raise HTTPException(status_code=409, detail="只有待审核提交可以标记为已审核")
    changed_at = now or utc_now()
    result = session.execute(
        update(CustomerFormSubmission)
        .where(
            CustomerFormSubmission.id == submission.id,
            CustomerFormSubmission.status == FormSubmissionStatus.SUBMITTED,
            CustomerFormSubmission.revision_number == submission.revision_number,
        )
        .values(
            status=FormSubmissionStatus.REVIEWED,
            reviewed_at=changed_at,
            revision_number=submission.revision_number + 1,
            updated_at=changed_at,
        )
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        raise HTTPException(status_code=409, detail="提交记录已被其他操作更新")
    session.expire(submission)
    record_intake_audit_event(
        session,
        event_type="reviewed",
        actor="admin",
        submission=submission,
    )


def _effective_payload(submission: CustomerFormSubmission) -> IntakeDraftPayload:
    return _safe_draft(submission.review_payload or submission.payload)


def _customer_payload(submission: CustomerFormSubmission) -> IntakeSubmissionPayload:
    try:
        return IntakeSubmissionPayload.model_validate(
            _effective_payload(submission).model_dump(mode="json")
        )
    except ValidationError as exc:
        raise HTTPException(
            status_code=409,
            detail="请先补齐客户姓名，并填写手机号或微信",
        ) from exc


def _order_payload(submission: CustomerFormSubmission) -> IntakeOrderArchivePayload:
    if submission.review_unit_price is None:
        raise HTTPException(status_code=409, detail="请先填写每次价格")
    try:
        return IntakeOrderArchivePayload.model_validate(
            _effective_payload(submission).model_dump(mode="json")
        )
    except ValidationError as exc:
        raise HTTPException(
            status_code=409,
            detail="请补齐地址、猫咪、服务日期、每日次数和服务事项",
        ) from exc


def _cat_has_content(cat: object) -> bool:
    values = cat.model_dump()
    return any(
        value not in (None, "", False, [])
        for key, value in values.items()
        if key != "medication_required"
    ) or bool(values.get("medication_required"))


def _build_customer_cats(
    session: Session,
    *,
    payload: IntakeSubmissionPayload | IntakeOrderArchivePayload,
) -> tuple[Customer, list[Cat]]:
    customer = build_customer(CustomerCreate(**payload.customer.model_dump()))
    session.add(customer)
    session.flush()

    cats: list[Cat] = []
    for cat_payload in payload.cats:
        if not _cat_has_content(cat_payload):
            continue
        if not cat_payload.name:
            raise HTTPException(status_code=409, detail="已填写的猫咪资料必须补充名字或移除")
        cat = Cat(
            customer_id=customer.id,
            **CatCreate(**cat_payload.model_dump()).model_dump(),
        )
        cats.append(cat)
    session.add_all(cats)
    session.flush()
    return customer, cats


def _decision_read(
    submission: CustomerFormSubmission,
    *,
    decision_mode: str | None = None,
) -> IntakeDecisionRead:
    mode = decision_mode or submission.decision_mode
    if mode not in {"customer", "order", "void"}:
        raise HTTPException(status_code=409, detail="归档回执不完整，请人工检查")
    return IntakeDecisionRead(
        submission_id=submission.id,
        submission_uuid=submission.submission_uuid,
        status=submission.status,
        decision_mode=mode,
        customer_id=submission.receipt_customer_id or submission.converted_customer_id,
        order_id=submission.receipt_order_id or submission.converted_order_id,
        revision=submission_revision(submission),
    )


def _terminal_status(mode: str) -> FormSubmissionStatus:
    if mode == "customer":
        return FormSubmissionStatus.ARCHIVED_CUSTOMER
    if mode == "order":
        return FormSubmissionStatus.ARCHIVED_ORDER
    if mode == "void":
        return FormSubmissionStatus.VOIDED
    raise ValueError(f"unknown intake decision mode: {mode}")


def _terminal_replay(
    submission: CustomerFormSubmission,
    *,
    decision_mode: str,
    idempotency_key: str,
) -> IntakeDecisionRead | None:
    terminal = {
        FormSubmissionStatus.ARCHIVED_CUSTOMER,
        FormSubmissionStatus.ARCHIVED_ORDER,
        FormSubmissionStatus.VOIDED,
        FormSubmissionStatus.CONVERTED,
        FormSubmissionStatus.REDACTED,
    }
    if submission.status not in terminal:
        return None
    stored_mode = submission.decision_mode or (
        "order" if submission.status is FormSubmissionStatus.CONVERTED else None
    )
    if stored_mode != decision_mode:
        raise HTTPException(status_code=409, detail="该提交已经按其他方式处理")
    if submission.idempotency_key != idempotency_key:
        raise HTTPException(status_code=409, detail="该提交已经使用其他幂等键处理")
    return _decision_read(submission, decision_mode=stored_mode)


def _claim_for_local_decision(
    session: Session,
    submission: CustomerFormSubmission,
    *,
    expected_revision: str,
    idempotency_key: str,
    decision_mode: str,
    changed_at: datetime,
) -> None:
    if submission_revision(submission) != expected_revision:
        raise HTTPException(status_code=409, detail="提交记录已变化，请刷新后重试")
    if submission.status not in {
        FormSubmissionStatus.SUBMITTED,
        FormSubmissionStatus.REVIEWED,
    }:
        raise HTTPException(status_code=409, detail="当前提交状态不能处理")
    result = session.execute(
        update(CustomerFormSubmission)
        .where(
            CustomerFormSubmission.id == submission.id,
            CustomerFormSubmission.status == submission.status,
            CustomerFormSubmission.revision_number == submission.revision_number,
        )
        .values(
            status=FormSubmissionStatus.PROCESSING,
            decision_mode=decision_mode,
            idempotency_key=idempotency_key,
            revision_number=submission.revision_number + 1,
            updated_at=changed_at,
        )
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        raise HTTPException(status_code=409, detail="提交记录已被其他操作更新")
    session.expire(submission)


def archive_customer_submission(
    session: Session,
    submission: CustomerFormSubmission,
    *,
    expected_revision: str,
    idempotency_key: str,
    now: datetime | None = None,
) -> IntakeDecisionRead:
    replay = _terminal_replay(
        submission,
        decision_mode="customer",
        idempotency_key=idempotency_key,
    )
    if replay is not None:
        return replay
    payload = _customer_payload(submission)
    changed_at = now or utc_now()
    _claim_for_local_decision(
        session,
        submission,
        expected_revision=expected_revision,
        idempotency_key=idempotency_key,
        decision_mode="customer",
        changed_at=changed_at,
    )
    customer, _ = _build_customer_cats(session, payload=payload)
    submission.status = FormSubmissionStatus.ARCHIVED_CUSTOMER
    submission.reviewed_at = submission.reviewed_at or changed_at
    submission.converted_at = changed_at
    submission.converted_customer_id = customer.id
    submission.converted_order_id = None
    submission.purge_after = None
    submission.revision_number += 1
    submission.updated_at = changed_at
    session.flush()
    record_intake_audit_event(
        session,
        event_type="archived_customer",
        actor="admin",
        submission=submission,
        decision_mode="customer",
        details={"customer_id": customer.id},
    )
    return _decision_read(submission)


def archive_order_submission(
    session: Session,
    submission: CustomerFormSubmission,
    *,
    expected_revision: str,
    idempotency_key: str,
    now: datetime | None = None,
) -> IntakeDecisionRead:
    replay = _terminal_replay(
        submission,
        decision_mode="order",
        idempotency_key=idempotency_key,
    )
    if replay is not None:
        return replay
    payload = _order_payload(submission)
    unit_price = submission.review_unit_price
    assert unit_price is not None
    changed_at = now or utc_now()
    _claim_for_local_decision(
        session,
        submission,
        expected_revision=expected_revision,
        idempotency_key=idempotency_key,
        decision_mode="order",
        changed_at=changed_at,
    )
    customer, cats = _build_customer_cats(session, payload=payload)
    order_payload = OrderWrite(
        customer_id=customer.id,
        cat_ids=[cat.id for cat in cats],
        start_date=payload.service.start_date,
        end_date=payload.service.end_date,
        visits_per_day=payload.service.visits_per_day,
        service_items=payload.service.service_items,
        base_price=unit_price,
        stairs_fee=Decimal("0.00"),
        other_fee=Decimal("0.00"),
        order_status=OrderStatus.CONFIRMED,
        notes=payload.notes,
    )
    order = build_order(order_payload, cats=cats, customer=customer)
    reprice_order(order, unit_price=unit_price)
    session.add(order)
    session.flush()

    submission.status = FormSubmissionStatus.ARCHIVED_ORDER
    submission.reviewed_at = submission.reviewed_at or changed_at
    submission.converted_at = changed_at
    submission.converted_customer_id = customer.id
    submission.converted_order_id = order.id
    submission.purge_after = None
    submission.revision_number += 1
    submission.updated_at = changed_at
    session.flush()
    record_intake_audit_event(
        session,
        event_type="archived_order",
        actor="admin",
        submission=submission,
        decision_mode="order",
        details={"customer_id": customer.id, "order_id": order.id},
    )
    return _decision_read(submission)


def void_submission(
    session: Session,
    submission: CustomerFormSubmission,
    *,
    expected_revision: str,
    idempotency_key: str,
    now: datetime | None = None,
) -> IntakeDecisionRead:
    replay = _terminal_replay(
        submission,
        decision_mode="void",
        idempotency_key=idempotency_key,
    )
    if replay is not None:
        return replay
    changed_at = now or utc_now()
    _claim_for_local_decision(
        session,
        submission,
        expected_revision=expected_revision,
        idempotency_key=idempotency_key,
        decision_mode="void",
        changed_at=changed_at,
    )
    submission.status = FormSubmissionStatus.VOIDED
    submission.voided_at = changed_at
    submission.purge_after = None
    submission.revision_number += 1
    submission.updated_at = changed_at
    session.flush()
    record_intake_audit_event(
        session,
        event_type="voided",
        actor="admin",
        submission=submission,
        decision_mode="void",
    )
    return _decision_read(submission)


def claim_submission(
    session: Session,
    submission: CustomerFormSubmission,
    *,
    expected_revision: str,
    idempotency_key: str,
    decision_mode: str,
    now: datetime | None = None,
) -> IntakeClaimRead:
    replay = _terminal_replay(
        submission,
        decision_mode=decision_mode,
        idempotency_key=idempotency_key,
    )
    if replay is not None:
        return IntakeClaimRead(
            submission_id=replay.submission_id,
            submission_uuid=replay.submission_uuid,
            status=replay.status,
            decision_mode=replay.decision_mode,
            claim_token=None,
            revision=replay.revision,
        )
    changed_at = now or utc_now()
    if submission.status is FormSubmissionStatus.PROCESSING:
        if submission_revision(submission) != expected_revision:
            raise HTTPException(status_code=409, detail="提交记录已变化，请刷新后重试")
        if (
            submission.idempotency_key != idempotency_key
            or submission.decision_mode != decision_mode
        ):
            raise HTTPException(status_code=409, detail="该提交正在执行其他审核动作")
        raw_claim = secrets.token_urlsafe(32)
        submission.claim_token_hash = token_digest(raw_claim)
        submission.claim_expires_at = changed_at + CLAIM_TTL
        submission.revision_number += 1
        submission.updated_at = changed_at
        session.flush()
        record_intake_audit_event(
            session,
            event_type="processing_reclaimed",
            actor="relay",
            submission=submission,
            decision_mode=decision_mode,
        )
        return IntakeClaimRead(
            submission_id=submission.id,
            submission_uuid=submission.submission_uuid,
            status=submission.status,
            decision_mode=decision_mode,
            claim_token=raw_claim,
            revision=submission_revision(submission),
        )
    if decision_mode == "customer":
        _customer_payload(submission)
    elif decision_mode == "order":
        _order_payload(submission)
    elif decision_mode != "void":
        raise HTTPException(status_code=422, detail="未知审核动作")
    raw_claim = secrets.token_urlsafe(32)
    _claim_for_local_decision(
        session,
        submission,
        expected_revision=expected_revision,
        idempotency_key=idempotency_key,
        decision_mode=decision_mode,
        changed_at=changed_at,
    )
    submission.claim_token_hash = token_digest(raw_claim)
    submission.claim_expires_at = changed_at + CLAIM_TTL
    submission.revision_number += 1
    session.flush()
    record_intake_audit_event(
        session,
        event_type="processing_claimed",
        actor="relay",
        submission=submission,
        decision_mode=decision_mode,
    )
    return IntakeClaimRead(
        submission_id=submission.id,
        submission_uuid=submission.submission_uuid,
        status=submission.status,
        decision_mode=decision_mode,
        claim_token=raw_claim,
        revision=submission_revision(submission),
    )


def complete_claim(
    session: Session,
    submission: CustomerFormSubmission,
    *,
    command: IntakeCompleteCommand,
    now: datetime | None = None,
) -> IntakeDecisionRead:
    replay = _terminal_replay(
        submission,
        decision_mode=command.decision_mode,
        idempotency_key=command.idempotency_key,
    )
    if replay is not None:
        return replay
    changed_at = now or utc_now()
    if submission.status is not FormSubmissionStatus.PROCESSING:
        raise HTTPException(status_code=409, detail="提交记录当前没有处理中租约")
    if submission.idempotency_key != command.idempotency_key:
        raise HTTPException(status_code=409, detail="幂等键与处理中记录不一致")
    if submission.decision_mode != command.decision_mode:
        raise HTTPException(status_code=409, detail="审核动作与处理中记录不一致")
    expires_at = as_utc(submission.claim_expires_at)
    if expires_at is None or expires_at <= changed_at:
        raise HTTPException(status_code=409, detail="处理租约已过期，请重新发起")
    if submission.claim_token_hash != token_digest(command.claim_token):
        raise HTTPException(status_code=403, detail="处理租约无效")
    if command.decision_mode in {"customer", "order"} and not command.customer_id:
        raise HTTPException(status_code=422, detail="归档完成回执缺少客户 ID")
    if command.decision_mode == "order" and not command.order_id:
        raise HTTPException(status_code=422, detail="订单归档回执缺少订单 ID")

    result = session.execute(
        update(CustomerFormSubmission)
        .where(
            CustomerFormSubmission.id == submission.id,
            CustomerFormSubmission.status == FormSubmissionStatus.PROCESSING,
            CustomerFormSubmission.revision_number == submission.revision_number,
            CustomerFormSubmission.idempotency_key == command.idempotency_key,
            CustomerFormSubmission.decision_mode == command.decision_mode,
            CustomerFormSubmission.claim_token_hash
            == token_digest(command.claim_token),
        )
        .values(
            status=_terminal_status(command.decision_mode),
            receipt_customer_id=command.customer_id,
            receipt_order_id=command.order_id,
            converted_at=(
                changed_at
                if command.decision_mode in {"customer", "order"}
                else None
            ),
            voided_at=(changed_at if command.decision_mode == "void" else None),
            purge_after=changed_at + RELAY_RETENTION,
            claim_token_hash=None,
            claim_expires_at=None,
            revision_number=submission.revision_number + 1,
            updated_at=changed_at,
        )
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        raise HTTPException(status_code=409, detail="处理租约已被其他请求完成")
    session.expire(submission)
    record_intake_audit_event(
        session,
        event_type=f"completed_{command.decision_mode}",
        actor="relay",
        submission=submission,
        decision_mode=command.decision_mode,
        details={
            "customer_id": command.customer_id,
            "order_id": command.order_id,
        },
    )
    return _decision_read(submission)


def redact_due_submissions(
    session: Session,
    *,
    now: datetime | None = None,
) -> int:
    if os.getenv(RELAY_SERVER_ENV) != "1":
        raise HTTPException(status_code=409, detail="本机正式档案禁止执行云端清理")
    changed_at = now or utc_now()
    redacted_ids = session.scalars(
        update(CustomerFormSubmission)
        .where(
            CustomerFormSubmission.status.in_(
                [
                    FormSubmissionStatus.ARCHIVED_CUSTOMER,
                    FormSubmissionStatus.ARCHIVED_ORDER,
                    FormSubmissionStatus.VOIDED,
                ]
            ),
            CustomerFormSubmission.purge_after.is_not(None),
            CustomerFormSubmission.purge_after <= changed_at,
        )
        .values(
            payload={},
            review_payload=None,
            review_unit_price=None,
            submit_payload_hash=None,
            status=FormSubmissionStatus.REDACTED,
            redacted_at=changed_at,
            revision_number=CustomerFormSubmission.revision_number + 1,
            updated_at=changed_at,
        )
        .returning(CustomerFormSubmission.id)
    ).all()
    if redacted_ids:
        redacted_submissions = session.scalars(
            select(CustomerFormSubmission).where(
                CustomerFormSubmission.id.in_(redacted_ids)
            )
        ).all()
        for submission in redacted_submissions:
            record_intake_audit_event(
                session,
                event_type="redacted",
                actor="system",
                submission=submission,
                decision_mode=submission.decision_mode,
            )
    return len(redacted_ids)


def convert_submission(
    session: Session,
    submission: CustomerFormSubmission,
    *,
    expected_revision: str,
    now: datetime | None = None,
) -> IntakeConversionRead:
    """Backward-compatible alias for the former order conversion endpoint."""

    result = archive_order_submission(
        session,
        submission,
        expected_revision=expected_revision,
        idempotency_key=f"legacy-convert-{submission.submission_uuid}",
        now=now,
    )
    if result.customer_id is None:
        raise HTTPException(status_code=409, detail="转换记录不完整，请人工检查")
    return IntakeConversionRead(
        submission_id=result.submission_id,
        status=result.status,
        customer_id=result.customer_id,
        order_id=result.order_id,
        revision=result.revision,
    )
