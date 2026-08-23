import type { DashboardPhotoSent, DashboardResponse } from "./types";
import { requestJson } from "../../lib/api";

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const dashboardPath = `${apiBase}/api/admin/dashboard`;

export class DashboardApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "DashboardApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return requestJson<T>(path, init, {
    errorFactory: (status, message) => new DashboardApiError(status, message),
  });
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
