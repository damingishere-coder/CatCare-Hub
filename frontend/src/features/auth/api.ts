import type { AccessRole, AuthSession } from "./types";

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const authPath = `${apiBase}/api/auth`;

interface ApiErrorPayload {
  detail?: string;
}

export class AuthApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new AuthApiError(0, "当前网络不可用，无法验证登录状态。");
  }
  if (!response.ok) {
    let message = `请求失败（HTTP ${response.status}）`;
    try {
      const payload = (await response.json()) as ApiErrorPayload;
      if (payload.detail) message = payload.detail;
    } catch {
      // Keep the HTTP fallback for non-JSON responses.
    }
    throw new AuthApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function getAuthSession(): Promise<AuthSession> {
  return request<AuthSession>(`${authPath}/session`);
}

export function loginWithAccessCode(
  role: AccessRole,
  accessCode: string,
): Promise<AuthSession> {
  return request<AuthSession>(`${authPath}/login`, {
    method: "POST",
    body: JSON.stringify({ role, access_code: accessCode }),
  });
}

export function logoutSession(): Promise<void> {
  return request<void>(`${authPath}/logout`, { method: "POST" });
}
