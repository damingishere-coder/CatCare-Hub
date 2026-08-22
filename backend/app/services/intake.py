import hashlib
import json
import re
import secrets
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.models.customer import Cat
from app.models.enums import FormSubmissionStatus, FormTokenStatus, OrderStatus
from app.models.intake import CustomerFormSubmission, CustomerFormToken
from app.schemas.customer import CatCreate, CustomerCreate
from app.schemas.intake import (
    IntakeConversionRead,
    IntakeDraftPayload,
    IntakeSubmissionDetail,
    IntakeSubmissionPayload,
    IntakeSubmissionSummary,
    IntakeTokenRead,
    PublicIntakeRead,
)
from app.schemas.order import OrderWrite
from app.services.business_time import as_utc
from app.services.credentials import token_digest
from app.services.customers import build_customer
from app.services.orders import DEFAULT_BASE_PRICE, build_order


TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{40,128}$")
TOKEN_GENERATION_ATTEMPTS = 5


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
            "status": submission.status.value,
            "payload": submission.payload,
            "reviewed_at": _iso(submission.reviewed_at),
            "converted_at": _iso(submission.converted_at),
            "converted_customer_id": submission.converted_customer_id,
            "converted_order_id": submission.converted_order_id,
            "updated_at": _iso(submission.updated_at),
        }
    )


def _submission_for(token: CustomerFormToken) -> CustomerFormSubmission | None:
    return token.submissions[0] if token.submissions else None


def _expire_token(token: CustomerFormToken, *, now: datetime) -> bool:
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
        draft = (
            IntakeDraftPayload.model_validate(submission.payload)
            if submission
            else IntakeDraftPayload()
        )
        return PublicIntakeRead(
            status="editable",
            expires_at=token.expires_at,
            draft=draft,
        )
    status_map = {
        FormSubmissionStatus.SUBMITTED: "submitted",
        FormSubmissionStatus.REVIEWED: "reviewed",
        FormSubmissionStatus.CONVERTED: "converted",
    }
    state = status_map.get(submission.status)
    if state is None:
        raise HTTPException(status_code=410, detail="填写链接已过期")
    return PublicIntakeRead(status=state, expires_at=token.expires_at)


def save_draft(
    token: CustomerFormToken,
    payload: IntakeDraftPayload,
) -> CustomerFormSubmission:
    submission = _submission_for(token)
    if token.submitted_at is not None or (
        submission is not None and submission.status is not FormSubmissionStatus.DRAFT
    ):
        raise HTTPException(status_code=409, detail="表单已提交，不能继续修改")
    if submission is None:
        submission = CustomerFormSubmission(
            token=token,
            payload=payload.model_dump(mode="json"),
        )
    else:
        submission.payload = payload.model_dump(mode="json")
    return submission


def submit_form(
    token: CustomerFormToken,
    payload: IntakeSubmissionPayload,
    *,
    now: datetime | None = None,
) -> CustomerFormSubmission:
    submission = _submission_for(token)
    if token.submitted_at is not None or (
        submission is not None and submission.status is not FormSubmissionStatus.DRAFT
    ):
        raise HTTPException(status_code=409, detail="表单已经提交")
    if submission is None:
        submission = CustomerFormSubmission(token=token, payload={})
    submission.payload = payload.model_dump(mode="json")
    submission.status = FormSubmissionStatus.SUBMITTED
    token.submitted_at = now or utc_now()
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


def _safe_draft(payload: dict[str, object]) -> IntakeDraftPayload:
    try:
        return IntakeDraftPayload.model_validate(payload)
    except ValidationError as exc:
        raise HTTPException(status_code=409, detail="历史表单数据无效，无法读取") from exc


def to_submission_summary(
    submission: CustomerFormSubmission,
) -> IntakeSubmissionSummary:
    payload = _safe_draft(submission.payload)
    return IntakeSubmissionSummary(
        id=submission.id,
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
        payload=_safe_draft(submission.payload),
        reviewed_at=submission.reviewed_at,
        converted_at=submission.converted_at,
        converted_customer_id=submission.converted_customer_id,
        converted_order_id=submission.converted_order_id,
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
        )
        .values(
            status=FormSubmissionStatus.REVIEWED,
            reviewed_at=changed_at,
            updated_at=changed_at,
        )
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        raise HTTPException(status_code=409, detail="提交记录已被其他操作更新")
    submission.status = FormSubmissionStatus.REVIEWED
    submission.reviewed_at = changed_at
    submission.updated_at = changed_at


def _validated_submission_payload(
    submission: CustomerFormSubmission,
) -> IntakeSubmissionPayload:
    try:
        return IntakeSubmissionPayload.model_validate(submission.payload)
    except ValidationError as exc:
        raise HTTPException(
            status_code=409,
            detail="提交内容未通过正式校验，不能转换",
        ) from exc


def convert_submission(
    session: Session,
    submission: CustomerFormSubmission,
    *,
    expected_revision: str,
    now: datetime | None = None,
) -> IntakeConversionRead:
    if submission.status is FormSubmissionStatus.CONVERTED:
        if submission.converted_customer_id and submission.converted_order_id:
            return IntakeConversionRead(
                submission_id=submission.id,
                status=submission.status,
                customer_id=submission.converted_customer_id,
                order_id=submission.converted_order_id,
                revision=submission_revision(submission),
            )
        raise HTTPException(status_code=409, detail="转换记录不完整，请人工检查")

    if submission_revision(submission) != expected_revision:
        raise HTTPException(status_code=409, detail="提交记录已变化，请刷新后重试")
    if submission.status not in {
        FormSubmissionStatus.SUBMITTED,
        FormSubmissionStatus.REVIEWED,
    }:
        raise HTTPException(status_code=409, detail="当前提交状态不能转换")

    payload = _validated_submission_payload(submission)
    changed_at = now or utc_now()
    original_status = submission.status
    result = session.execute(
        update(CustomerFormSubmission)
        .where(
            CustomerFormSubmission.id == submission.id,
            CustomerFormSubmission.status == original_status,
        )
        .values(
            status=FormSubmissionStatus.REVIEWED,
            reviewed_at=submission.reviewed_at or changed_at,
            updated_at=changed_at,
        )
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        session.expire_all()
        current = session.get(CustomerFormSubmission, submission.id)
        if (
            current
            and current.status is FormSubmissionStatus.CONVERTED
            and current.converted_customer_id
            and current.converted_order_id
        ):
            return IntakeConversionRead(
                submission_id=current.id,
                status=current.status,
                customer_id=current.converted_customer_id,
                order_id=current.converted_order_id,
                revision=submission_revision(current),
            )
        raise HTTPException(status_code=409, detail="提交记录已被其他操作更新")

    customer_values = payload.customer.model_dump()
    customer = build_customer(
        CustomerCreate(**customer_values, is_repeat_customer=False)
    )
    session.add(customer)
    session.flush()

    cats = [
        Cat(customer_id=customer.id, **CatCreate(**cat.model_dump()).model_dump())
        for cat in payload.cats
    ]
    session.add_all(cats)
    session.flush()

    order_payload = OrderWrite(
        customer_id=customer.id,
        cat_ids=[cat.id for cat in cats],
        start_date=payload.service.start_date,
        end_date=payload.service.end_date,
        visits_per_day=payload.service.visits_per_day,
        service_items=payload.service.service_items,
        base_price=DEFAULT_BASE_PRICE,
        stairs_fee=Decimal("0.00"),
        other_fee=Decimal("0.00"),
        order_status=OrderStatus.PENDING_CONFIRMATION,
        notes=payload.notes,
    )
    order = build_order(order_payload, cats=cats)
    session.add(order)
    session.flush()

    submission.status = FormSubmissionStatus.CONVERTED
    submission.reviewed_at = submission.reviewed_at or changed_at
    submission.converted_at = changed_at
    submission.converted_customer_id = customer.id
    submission.converted_order_id = order.id
    submission.updated_at = changed_at
    return IntakeConversionRead(
        submission_id=submission.id,
        status=submission.status,
        customer_id=customer.id,
        order_id=order.id,
        revision=submission_revision(submission),
    )
