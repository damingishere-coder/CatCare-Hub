from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.db.session import get_db
from app.models.enums import FormSubmissionStatus
from app.models.intake import CustomerFormSubmission, CustomerFormToken
from app.models.system import SystemFlag
from app.schemas.intake import (
    IntakeClaimCommand,
    IntakeClaimRead,
    IntakeCompleteCommand,
    IntakeConversionRead,
    IntakeDecisionCommand,
    IntakeDecisionRead,
    IntakeDraftPayload,
    IntakeListStateUpdate,
    IntakeRedactionRead,
    IntakeReviewDraftUpdate,
    IntakeSubmissionDetail,
    IntakeSubmissionList,
    IntakeTokenList,
    IntakeTokenRead,
    PublicDraftUpdate,
    PublicIntakeRead,
    PublicSubmitCommand,
    RevisionCommand,
    TokenCreate,
    TokenStatusUpdate,
)
from app.services.intake import (
    archive_customer_submission,
    archive_order_submission,
    claim_submission,
    complete_claim,
    convert_submission,
    create_token,
    expire_loaded_tokens,
    load_public_token,
    mark_reviewed,
    public_read,
    redact_due_submissions,
    save_draft,
    save_review_draft,
    submit_form,
    to_submission_detail,
    to_submission_summary,
    to_token_read,
    update_token_status,
    void_submission,
)
from app.services.intake_remote import (
    RemoteIntakeClient,
    archive_remote_submission,
    hydrate_remote_detail,
    hydrate_remote_list,
    remote_intake_enabled,
)


public_router = APIRouter(prefix="/api/fill", tags=["customer-fill"])
admin_router = APIRouter(prefix="/api/admin/intake", tags=["admin-intake"])
relay_admin_router = APIRouter(
    prefix="/api/admin/intake",
    tags=["intake-relay-sync"],
)
DatabaseSession = Annotated[Session, Depends(get_db)]
REMOVED_FLAG_PREFIX = "intake-list-removed:"


def _token_options():
    return (selectinload(CustomerFormToken.submissions),)


def _load_admin_token(session: Session, token_id: int) -> CustomerFormToken:
    token = session.scalar(
        select(CustomerFormToken)
        .options(*_token_options())
        .where(CustomerFormToken.id == token_id)
    )
    if token is None:
        raise HTTPException(status_code=404, detail="填写链接不存在")
    return token


def _removed_key(submission_uuid: str) -> str:
    return f"{REMOVED_FLAG_PREFIX}{submission_uuid}"


def _decorate_removed_state(
    session: Session,
    detail: IntakeSubmissionDetail,
) -> IntakeSubmissionDetail:
    flag = session.get(SystemFlag, _removed_key(detail.submission_uuid))
    return detail.model_copy(update={"removed_at": flag.created_at if flag else None})


def _decorate_removed_list(
    session: Session,
    response: IntakeSubmissionList,
) -> IntakeSubmissionList:
    keys = [_removed_key(item.submission_uuid) for item in response.items]
    flags = {
        flag.key: flag
        for flag in (
            session.scalars(select(SystemFlag).where(SystemFlag.key.in_(keys))).all()
            if keys
            else []
        )
    }
    return response.model_copy(
        update={
            "items": [
                item.model_copy(
                    update={
                        "removed_at": (
                            flags[_removed_key(item.submission_uuid)].created_at
                            if _removed_key(item.submission_uuid) in flags
                            else None
                        )
                    }
                )
                for item in response.items
            ]
        }
    )


def _submission_options():
    return (
        selectinload(CustomerFormSubmission.token),
        selectinload(CustomerFormSubmission.audit_events),
    )


def _load_submission(session: Session, submission_id: int) -> CustomerFormSubmission:
    submission = session.scalar(
        select(CustomerFormSubmission)
        .options(*_submission_options())
        .where(CustomerFormSubmission.id == submission_id)
    )
    if submission is None:
        raise HTTPException(status_code=404, detail="提交记录不存在")
    return submission


def _load_public_token(session: Session, token: str) -> CustomerFormToken:
    try:
        return load_public_token(session, token)
    except HTTPException:
        if session.dirty:
            session.commit()
        raise


def _commit_public_form(session: Session) -> None:
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(
            status_code=409,
            detail="表单已被其他请求更新，请刷新后重试",
        ) from exc


@public_router.get("/{token}", response_model=PublicIntakeRead)
def get_public_form(token: str, session: DatabaseSession) -> PublicIntakeRead:
    form_token = _load_public_token(session, token)
    if session.dirty:
        session.commit()
    return public_read(form_token)


@public_router.put("/{token}", response_model=PublicIntakeRead)
def put_public_draft(
    token: str,
    payload: PublicDraftUpdate,
    session: DatabaseSession,
) -> PublicIntakeRead:
    form_token = _load_public_token(session, token)
    session.add(
        save_draft(
            session,
            form_token,
            payload.draft,
            expected_revision=payload.expected_revision,
        )
    )
    _commit_public_form(session)
    return public_read(form_token)


@public_router.post("/{token}/submit", response_model=PublicIntakeRead)
def post_public_submission(
    token: str,
    payload: PublicSubmitCommand,
    session: DatabaseSession,
) -> PublicIntakeRead:
    form_token = _load_public_token(session, token)
    session.add(
        submit_form(
            session,
            form_token,
            payload.payload,
            expected_revision=payload.expected_revision,
            idempotency_key=payload.idempotency_key,
        )
    )
    _commit_public_form(session)
    return public_read(form_token)


@admin_router.get("/tokens", response_model=IntakeTokenList)
@relay_admin_router.get("/tokens", response_model=IntakeTokenList)
def list_tokens(session: DatabaseSession) -> IntakeTokenList:
    if remote_intake_enabled():
        return RemoteIntakeClient().list_tokens()
    tokens = session.scalars(
        select(CustomerFormToken)
        .options(*_token_options())
        .order_by(CustomerFormToken.created_at.desc(), CustomerFormToken.id.desc())
    ).all()
    if expire_loaded_tokens(tokens):
        session.commit()
    return IntakeTokenList(items=[to_token_read(token) for token in tokens], total=len(tokens))


@admin_router.post(
    "/tokens",
    response_model=IntakeTokenRead,
    status_code=status.HTTP_201_CREATED,
)
@relay_admin_router.post(
    "/tokens",
    response_model=IntakeTokenRead,
    status_code=status.HTTP_201_CREATED,
)
def post_token(payload: TokenCreate, session: DatabaseSession) -> IntakeTokenRead:
    if remote_intake_enabled():
        return RemoteIntakeClient().create_token(
            expires_in_days=payload.expires_in_days
        )
    token, raw_token = create_token(session, expires_in_days=payload.expires_in_days)
    session.commit()
    return to_token_read(token, raw_token=raw_token)


@admin_router.patch("/tokens/{token_id}", response_model=IntakeTokenRead)
@relay_admin_router.patch("/tokens/{token_id}", response_model=IntakeTokenRead)
def patch_token(
    token_id: int,
    payload: TokenStatusUpdate,
    session: DatabaseSession,
) -> IntakeTokenRead:
    if remote_intake_enabled():
        return RemoteIntakeClient().update_token(
            token_id,
            status=payload.status.value,
            expected_revision=payload.expected_revision,
        )
    token = _load_admin_token(session, token_id)
    update_token_status(
        session,
        token,
        target=payload.status,
        expected_revision=payload.expected_revision,
    )
    session.commit()
    return to_token_read(token)


@admin_router.get("/submissions", response_model=IntakeSubmissionList)
@relay_admin_router.get("/submissions", response_model=IntakeSubmissionList)
def list_submissions(
    session: DatabaseSession,
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> IntakeSubmissionList:
    if remote_intake_enabled():
        return _decorate_removed_list(
            session,
            hydrate_remote_list(
                session,
                RemoteIntakeClient().list_submissions(limit=limit, offset=offset),
            ),
        )
    status_filter = CustomerFormSubmission.status != FormSubmissionStatus.DRAFT
    total = session.scalar(
        select(func.count(CustomerFormSubmission.id)).where(status_filter)
    ) or 0
    submissions = session.scalars(
        select(CustomerFormSubmission)
        .options(*_submission_options())
        .where(status_filter)
        .order_by(
            CustomerFormSubmission.updated_at.desc(),
            CustomerFormSubmission.id.desc(),
        )
        .limit(limit)
        .offset(offset)
    ).all()
    return _decorate_removed_list(
        session,
        IntakeSubmissionList(
            items=[to_submission_summary(item) for item in submissions],
            total=total,
        ),
    )


@admin_router.get(
    "/submissions/{submission_id}",
    response_model=IntakeSubmissionDetail,
)
@relay_admin_router.get(
    "/submissions/{submission_id}",
    response_model=IntakeSubmissionDetail,
)
def get_submission(
    submission_id: int,
    session: DatabaseSession,
) -> IntakeSubmissionDetail:
    if remote_intake_enabled():
        return _decorate_removed_state(
            session,
            hydrate_remote_detail(
                session,
                RemoteIntakeClient().get_submission(submission_id),
            ),
        )
    return _decorate_removed_state(
        session,
        to_submission_detail(_load_submission(session, submission_id)),
    )


@admin_router.patch(
    "/submissions/{submission_id}/list-state",
    response_model=IntakeSubmissionDetail,
)
def update_submission_list_state(
    submission_id: int,
    payload: IntakeListStateUpdate,
    session: DatabaseSession,
) -> IntakeSubmissionDetail:
    detail = (
        hydrate_remote_detail(
            session,
            RemoteIntakeClient().get_submission(submission_id),
        )
        if remote_intake_enabled()
        else to_submission_detail(_load_submission(session, submission_id))
    )
    if detail.revision != payload.expected_revision:
        raise HTTPException(status_code=409, detail="提交记录已变化，请刷新后重试")
    voided = detail.status is FormSubmissionStatus.VOIDED or (
        detail.status is FormSubmissionStatus.REDACTED
        and detail.decision_mode == "void"
    )
    if payload.removed and not voided:
        raise HTTPException(status_code=409, detail="只有已作废记录可以从列表移除")
    key = _removed_key(detail.submission_uuid)
    flag = session.get(SystemFlag, key)
    if payload.removed and flag is None:
        session.add(SystemFlag(key=key, payload={"removed": True}))
    elif not payload.removed and flag is not None:
        session.delete(flag)
    session.commit()
    return _decorate_removed_state(session, detail)


@admin_router.put(
    "/submissions/{submission_id}/review-draft",
    response_model=IntakeSubmissionDetail,
)
@relay_admin_router.put(
    "/submissions/{submission_id}/review-draft",
    response_model=IntakeSubmissionDetail,
)
def put_review_draft(
    submission_id: int,
    payload: IntakeReviewDraftUpdate,
    session: DatabaseSession,
) -> IntakeSubmissionDetail:
    if remote_intake_enabled():
        return RemoteIntakeClient().save_review(
            submission_id,
            review_payload=payload.review_payload.model_dump(mode="json"),
            unit_price=(str(payload.unit_price) if payload.unit_price is not None else None),
            expected_revision=payload.expected_revision,
        )
    submission = _load_submission(session, submission_id)
    save_review_draft(
        session,
        submission,
        review_payload=payload.review_payload,
        unit_price=payload.unit_price,
        expected_revision=payload.expected_revision,
    )
    session.commit()
    return to_submission_detail(_load_submission(session, submission_id))


@admin_router.post(
    "/submissions/{submission_id}/review",
    response_model=IntakeSubmissionDetail,
)
def review_submission(
    submission_id: int,
    payload: RevisionCommand,
    session: DatabaseSession,
) -> IntakeSubmissionDetail:
    if remote_intake_enabled():
        raise HTTPException(status_code=409, detail="云端审核请先保存审核稿")
    submission = _load_submission(session, submission_id)
    mark_reviewed(
        session,
        submission,
        expected_revision=payload.expected_revision,
    )
    session.commit()
    return to_submission_detail(_load_submission(session, submission_id))


@admin_router.post(
    "/submissions/{submission_id}/convert",
    response_model=IntakeConversionRead,
)
def confirm_submission(
    submission_id: int,
    payload: RevisionCommand,
    session: DatabaseSession,
) -> IntakeConversionRead:
    if remote_intake_enabled():
        result = archive_remote_submission(
            session,
            remote_submission_id=submission_id,
            expected_revision=payload.expected_revision,
            idempotency_key=f"legacy-convert-{submission_id:020d}",
            decision_mode="order",
        )
        if result.customer_id is None:
            raise HTTPException(status_code=409, detail="归档回执缺少客户 ID")
        return IntakeConversionRead(
            submission_id=result.submission_id,
            status=result.status,
            customer_id=result.customer_id,
            order_id=result.order_id,
            revision=result.revision,
        )
    submission = _load_submission(session, submission_id)
    try:
        result = convert_submission(
            session,
            submission,
            expected_revision=payload.expected_revision,
        )
        session.commit()
        return result
    except Exception:
        session.rollback()
        raise


def _commit_decision(session: Session, operation) -> IntakeDecisionRead:
    try:
        result = operation()
        session.commit()
        return result
    except Exception:
        session.rollback()
        raise


@admin_router.post(
    "/submissions/{submission_id}/archive-customer",
    response_model=IntakeDecisionRead,
)
def archive_customer(
    submission_id: int,
    payload: IntakeDecisionCommand,
    session: DatabaseSession,
) -> IntakeDecisionRead:
    if remote_intake_enabled():
        return archive_remote_submission(
            session,
            remote_submission_id=submission_id,
            expected_revision=payload.expected_revision,
            idempotency_key=payload.idempotency_key,
            decision_mode="customer",
        )
    submission = _load_submission(session, submission_id)
    return _commit_decision(
        session,
        lambda: archive_customer_submission(
            session,
            submission,
            expected_revision=payload.expected_revision,
            idempotency_key=payload.idempotency_key,
        ),
    )


@admin_router.post(
    "/submissions/{submission_id}/archive-order",
    response_model=IntakeDecisionRead,
)
def archive_order(
    submission_id: int,
    payload: IntakeDecisionCommand,
    session: DatabaseSession,
) -> IntakeDecisionRead:
    if remote_intake_enabled():
        return archive_remote_submission(
            session,
            remote_submission_id=submission_id,
            expected_revision=payload.expected_revision,
            idempotency_key=payload.idempotency_key,
            decision_mode="order",
        )
    submission = _load_submission(session, submission_id)
    return _commit_decision(
        session,
        lambda: archive_order_submission(
            session,
            submission,
            expected_revision=payload.expected_revision,
            idempotency_key=payload.idempotency_key,
        ),
    )


@admin_router.post(
    "/submissions/{submission_id}/void",
    response_model=IntakeDecisionRead,
)
def void_intake(
    submission_id: int,
    payload: IntakeDecisionCommand,
    session: DatabaseSession,
) -> IntakeDecisionRead:
    if remote_intake_enabled():
        return archive_remote_submission(
            session,
            remote_submission_id=submission_id,
            expected_revision=payload.expected_revision,
            idempotency_key=payload.idempotency_key,
            decision_mode="void",
        )
    submission = _load_submission(session, submission_id)
    return _commit_decision(
        session,
        lambda: void_submission(
            session,
            submission,
            expected_revision=payload.expected_revision,
            idempotency_key=payload.idempotency_key,
        ),
    )


@admin_router.post(
    "/submissions/{submission_id}/claim",
    response_model=IntakeClaimRead,
)
@relay_admin_router.post(
    "/submissions/{submission_id}/claim",
    response_model=IntakeClaimRead,
)
def claim_intake(
    submission_id: int,
    payload: IntakeClaimCommand,
    session: DatabaseSession,
) -> IntakeClaimRead:
    submission = _load_submission(session, submission_id)
    result = claim_submission(
        session,
        submission,
        expected_revision=payload.expected_revision,
        idempotency_key=payload.idempotency_key,
        decision_mode=payload.decision_mode,
    )
    session.commit()
    return result


@admin_router.post(
    "/submissions/{submission_id}/complete",
    response_model=IntakeDecisionRead,
)
@relay_admin_router.post(
    "/submissions/{submission_id}/complete",
    response_model=IntakeDecisionRead,
)
def complete_intake(
    submission_id: int,
    payload: IntakeCompleteCommand,
    session: DatabaseSession,
) -> IntakeDecisionRead:
    submission = _load_submission(session, submission_id)
    result = complete_claim(session, submission, command=payload)
    session.commit()
    return result


@relay_admin_router.post("/maintenance/redact", response_model=IntakeRedactionRead)
def redact_intake(session: DatabaseSession) -> IntakeRedactionRead:
    count = redact_due_submissions(session)
    session.commit()
    return IntakeRedactionRead(redacted_count=count)
