import type {
  DayPlan,
  PlanDaysResponse,
  PlanRoutePreviewInput,
  PlanRouteWorkspace,
  PlanScheduleInput,
  PlanTaskDetail,
  PlanTaskStatusInput,
} from "./types";
import { notifyUnauthorized } from "../../lib/authEvents";

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const plansPath = `${apiBase}/api/admin/plans`;

interface ApiErrorPayload {
  detail?: string | Array<{ msg?: string }>;
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
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export function getPlanDays(): Promise<PlanDaysResponse> {
  return request<PlanDaysResponse>(`${plansPath}/days`);
}

export function getDayPlan(serviceDate: string): Promise<DayPlan> {
  return request<DayPlan>(`${plansPath}/${serviceDate}`);
}

export function getPlanTask(taskId: number): Promise<PlanTaskDetail> {
  return request<PlanTaskDetail>(`${plansPath}/tasks/${taskId}`);
}

export function getPlanRoute(serviceDate: string): Promise<PlanRouteWorkspace> {
  return request<PlanRouteWorkspace>(`${plansPath}/${serviceDate}/route`);
}

export function previewPlanRoute(
  serviceDate: string,
  payload: PlanRoutePreviewInput,
): Promise<PlanRouteWorkspace> {
  return request<PlanRouteWorkspace>(`${plansPath}/${serviceDate}/route/preview`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function saveDaySchedule(
  serviceDate: string,
  payload: PlanScheduleInput,
): Promise<DayPlan> {
  return request<DayPlan>(`${plansPath}/${serviceDate}/schedule`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function updatePlanTaskStatus(
  taskId: number,
  payload: PlanTaskStatusInput,
): Promise<PlanTaskDetail> {
  return request<PlanTaskDetail>(`${plansPath}/tasks/${taskId}/status`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}
