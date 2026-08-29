import type {
  FormTokenStatus,
  IntakeConversionRead,
  IntakeDraftPayload,
  IntakeDecisionMode,
  IntakeDecisionRead,
  IntakeSubmissionDetail,
  IntakeSubmissionList,
  IntakeTokenList,
  IntakeTokenRead,
  PublicIntakeDraftPayload,
  PublicIntakeRead,
} from "./types";
import { requestJson } from "../../lib/api";

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const adminPath = `${apiBase}/api/admin/intake`;

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return requestJson<T>(path, init, {
    errorFactory: (status, message) => new ApiError(status, message),
  });
}

function publicPath(token: string): string {
  return `${apiBase}/api/fill/${encodeURIComponent(token)}`;
}

export function getPublicIntake(token: string): Promise<PublicIntakeRead> {
  return request<PublicIntakeRead>(publicPath(token));
}

export function savePublicDraft(
  token: string,
  payload: PublicIntakeDraftPayload,
  expectedRevision: string,
): Promise<PublicIntakeRead> {
  return request<PublicIntakeRead>(publicPath(token), {
    method: "PUT",
    body: JSON.stringify({ draft: payload, expected_revision: expectedRevision }),
  });
}

export function submitPublicIntake(
  token: string,
  payload: PublicIntakeDraftPayload,
  expectedRevision: string,
  idempotencyKey: string,
): Promise<PublicIntakeRead> {
  return request<PublicIntakeRead>(`${publicPath(token)}/submit`, {
    method: "POST",
    body: JSON.stringify({
      payload,
      expected_revision: expectedRevision,
      idempotency_key: idempotencyKey,
    }),
  });
}

export function listIntakeTokens(): Promise<IntakeTokenList> {
  return request<IntakeTokenList>(`${adminPath}/tokens`);
}

export function createIntakeToken(expiresInDays: number): Promise<IntakeTokenRead> {
  return request<IntakeTokenRead>(`${adminPath}/tokens`, {
    method: "POST",
    body: JSON.stringify({ expires_in_days: expiresInDays }),
  });
}

export function updateIntakeToken(
  tokenId: number,
  status: Exclude<FormTokenStatus, "expired">,
  expectedRevision: string,
): Promise<IntakeTokenRead> {
  return request<IntakeTokenRead>(`${adminPath}/tokens/${tokenId}`, {
    method: "PATCH",
    body: JSON.stringify({ status, expected_revision: expectedRevision }),
  });
}

export function listIntakeSubmissions(): Promise<IntakeSubmissionList> {
  return request<IntakeSubmissionList>(`${adminPath}/submissions`);
}

export function getIntakeSubmission(submissionId: number): Promise<IntakeSubmissionDetail> {
  return request<IntakeSubmissionDetail>(`${adminPath}/submissions/${submissionId}`);
}

export function updateIntakeSubmissionListState(
  submissionId: number,
  removed: boolean,
  expectedRevision: string,
): Promise<IntakeSubmissionDetail> {
  return request<IntakeSubmissionDetail>(`${adminPath}/submissions/${submissionId}/list-state`, {
    method: "PATCH",
    body: JSON.stringify({ removed, expected_revision: expectedRevision }),
  });
}

export function reviewIntakeSubmission(
  submissionId: number,
  expectedRevision: string,
): Promise<IntakeSubmissionDetail> {
  return request<IntakeSubmissionDetail>(`${adminPath}/submissions/${submissionId}/review`, {
    method: "POST",
    body: JSON.stringify({ expected_revision: expectedRevision }),
  });
}

export function saveIntakeReviewDraft(
  submissionId: number,
  reviewPayload: IntakeDraftPayload,
  unitPrice: string | null,
  expectedRevision: string,
): Promise<IntakeSubmissionDetail> {
  return request<IntakeSubmissionDetail>(`${adminPath}/submissions/${submissionId}/review-draft`, {
    method: "PUT",
    body: JSON.stringify({
      review_payload: reviewPayload,
      unit_price: unitPrice,
      expected_revision: expectedRevision,
    }),
  });
}

export function convertIntakeSubmission(
  submissionId: number,
  expectedRevision: string,
): Promise<IntakeConversionRead> {
  return request<IntakeConversionRead>(`${adminPath}/submissions/${submissionId}/convert`, {
    method: "POST",
    body: JSON.stringify({ expected_revision: expectedRevision }),
  });
}

export function decideIntakeSubmission(
  submissionId: number,
  mode: IntakeDecisionMode,
  expectedRevision: string,
  idempotencyKey: string,
): Promise<IntakeDecisionRead> {
  const endpoint = mode === "customer" ? "archive-customer" : mode === "order" ? "archive-order" : "void";
  return request<IntakeDecisionRead>(`${adminPath}/submissions/${submissionId}/${endpoint}`, {
    method: "POST",
    body: JSON.stringify({
      expected_revision: expectedRevision,
      idempotency_key: idempotencyKey,
    }),
  });
}
