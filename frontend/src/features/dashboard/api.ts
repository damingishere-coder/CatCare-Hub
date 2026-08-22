import type { DashboardPhotoSent, DashboardResponse } from "./types";
import { notifyUnauthorized } from "../../lib/authEvents";

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const dashboardPath = `${apiBase}/api/admin/dashboard`;

interface ApiErrorPayload {
  detail?: string | Array<{ msg?: string }>;
}

export class DashboardApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "DashboardApiError";
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
      // Keep the HTTP fallback when the response is not JSON.
    }
    throw new DashboardApiError(response.status, message);
  }
  return (await response.json()) as T;
}

export function getDashboard(businessDate?: string): Promise<DashboardResponse> {
  const query = businessDate ? `?${new URLSearchParams({ date: businessDate })}` : "";
  return request<DashboardResponse>(`${dashboardPath}${query}`);
}

export function markTaskPhotosSent(
  taskId: number,
  expectedRevision: string,
): Promise<DashboardPhotoSent> {
  return request<DashboardPhotoSent>(`${dashboardPath}/tasks/${taskId}/photos-sent`, {
    method: "POST",
    body: JSON.stringify({ expected_revision: expectedRevision }),
  });
}
