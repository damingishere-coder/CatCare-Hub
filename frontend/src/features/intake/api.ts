import type {
  FormTokenStatus,
  IntakeConversionRead,
  IntakeDraftPayload,
  IntakeSubmissionDetail,
  IntakeSubmissionList,
  IntakeTokenList,
  IntakeTokenRead,
  PublicIntakeRead,
} from "./types";
import { notifyUnauthorized } from "../../lib/authEvents";

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const adminPath = `${apiBase}/api/admin/intake`;

interface ApiErrorPayload {
  detail?: string | Array<{ msg?: string }>;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    notifyUnauthorized(response.status);
    let message = `请求失败（HTTP ${response.status}）`;
    try {
      const payload = (await response.json()) as ApiErrorPayload;
      if (typeof payload.detail === "string") {
        message = payload.detail;
      } else if (Array.isArray(payload.detail)) {
        message = payload.detail.map((item) => item.msg).filter(Boolean).join("；") || message;
      }
    } catch {
      // Keep the HTTP fallback when the body is not JSON.
    }
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
}

function publicPath(token: string): string {
  return `${apiBase}/api/fill/${encodeURIComponent(token)}`;
}

export function getPublicIntake(token: string): Promise<PublicIntakeRead> {
  return request<PublicIntakeRead>(publicPath(token));
}

export function savePublicDraft(
  token: string,
  payload: IntakeDraftPayload,
): Promise<PublicIntakeRead> {
  return request<PublicIntakeRead>(publicPath(token), {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function submitPublicIntake(
  token: string,
  payload: IntakeDraftPayload,
): Promise<PublicIntakeRead> {
  return request<PublicIntakeRead>(`${publicPath(token)}/submit`, {
    method: "POST",
    body: JSON.stringify(payload),
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

export function reviewIntakeSubmission(
  submissionId: number,
  expectedRevision: string,
): Promise<IntakeSubmissionDetail> {
  return request<IntakeSubmissionDetail>(`${adminPath}/submissions/${submissionId}/review`, {
    method: "POST",
    body: JSON.stringify({ expected_revision: expectedRevision }),
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
