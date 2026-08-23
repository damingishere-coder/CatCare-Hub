from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.db.session import get_db
from app.models.enums import FormSubmissionStatus
from app.models.intake import CustomerFormSubmission, CustomerFormToken
from app.schemas.intake import (
    IntakeConversionRead,
    IntakeDraftPayload,
    IntakeReviewDraftUpdate,
    IntakeSubmissionDetail,
    IntakeSubmissionList,
    IntakeSubmissionPayload,
    IntakeTokenList,
    IntakeTokenRead,
    PublicIntakeRead,
    RevisionCommand,
    TokenCreate,
    TokenStatusUpdate,
)
from app.services.intake import (
    convert_submission,
    create_token,
    expire_loaded_tokens,
    load_public_token,
    mark_reviewed,
    public_read,
    save_draft,
    save_review_draft,
    submit_form,
    to_submission_detail,
    to_submission_summary,
    to_token_read,
    update_token_status,
)


public_router = APIRouter(prefix="/api/fill", tags=["customer-fill"])
admin_router = APIRouter(prefix="/api/admin/intake", tags=["admin-intake"])
DatabaseSession = Annotated[Session, Depends(get_db)]


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


def _submission_options():
    return (selectinload(CustomerFormSubmission.token),)


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
    payload: IntakeDraftPayload,
    session: DatabaseSession,
) -> PublicIntakeRead:
    form_token = _load_public_token(session, token)
    session.add(save_draft(form_token, payload))
    _commit_public_form(session)
    return public_read(form_token)


@public_router.post("/{token}/submit", response_model=PublicIntakeRead)
def post_public_submission(
    token: str,
    payload: IntakeSubmissionPayload,
    session: DatabaseSession,
) -> PublicIntakeRead:
    form_token = _load_public_token(session, token)
    session.add(submit_form(form_token, payload))
    _commit_public_form(session)
    return public_read(form_token)


@admin_router.get("/tokens", response_model=IntakeTokenList)
def list_tokens(session: DatabaseSession) -> IntakeTokenList:
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
def post_token(payload: TokenCreate, session: DatabaseSession) -> IntakeTokenRead:
    token, raw_token = create_token(session, expires_in_days=payload.expires_in_days)
    session.commit()
    return to_token_read(token, raw_token=raw_token)


@admin_router.patch("/tokens/{token_id}", response_model=IntakeTokenRead)
def patch_token(
    token_id: int,
    payload: TokenStatusUpdate,
    session: DatabaseSession,
) -> IntakeTokenRead:
    token = _load_admin_token(session, token_id)
    update_token_status(
        token,
        target=payload.status,
        expected_revision=payload.expected_revision,
    )
    session.commit()
    return to_token_read(token)


@admin_router.get("/submissions", response_model=IntakeSubmissionList)
def list_submissions(session: DatabaseSession) -> IntakeSubmissionList:
    submissions = session.scalars(
        select(CustomerFormSubmission)
        .options(*_submission_options())
        .where(CustomerFormSubmission.status != FormSubmissionStatus.DRAFT)
        .order_by(
            CustomerFormSubmission.updated_at.desc(),
            CustomerFormSubmission.id.desc(),
        )
    ).all()
    return IntakeSubmissionList(
        items=[to_submission_summary(item) for item in submissions],
        total=len(submissions),
    )


@admin_router.get(
    "/submissions/{submission_id}",
    response_model=IntakeSubmissionDetail,
)
def get_submission(
    submission_id: int,
    session: DatabaseSession,
) -> IntakeSubmissionDetail:
    return to_submission_detail(_load_submission(session, submission_id))


@admin_router.put(
    "/submissions/{submission_id}/review-draft",
    response_model=IntakeSubmissionDetail,
)
def put_review_draft(
    submission_id: int,
    payload: IntakeReviewDraftUpdate,
    session: DatabaseSession,
) -> IntakeSubmissionDetail:
    submission = _load_submission(session, submission_id)
    save_review_draft(
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
