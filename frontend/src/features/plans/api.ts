import type {
  DayPlan,
  PlanDaysResponse,
  PlanRoutePreviewInput,
  PlanRouteWorkspace,
  PlanScheduleInput,
  PlanTaskDetail,
  PlanTaskStatusInput,
} from "./types";
import { requestJson, ROUTE_REQUEST_TIMEOUT_MS } from "../../lib/api";

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const plansPath = `${apiBase}/api/admin/plans`;

async function request<T>(path: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  return requestJson<T>(path, init, { timeoutMs });
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
  return request<PlanRouteWorkspace>(`${plansPath}/${serviceDate}/route`, undefined, ROUTE_REQUEST_TIMEOUT_MS);
}

export function previewPlanRoute(
  serviceDate: string,
  payload: PlanRoutePreviewInput,
): Promise<PlanRouteWorkspace> {
  return request<PlanRouteWorkspace>(
    `${plansPath}/${serviceDate}/route/preview`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    ROUTE_REQUEST_TIMEOUT_MS,
  );
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
