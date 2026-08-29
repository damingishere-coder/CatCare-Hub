import type {
  DayPlan,
  PlanDaysResponse,
  PlanRoutePreviewInput,
  PlanRouteWorkspace,
  PlanScheduleInput,
  PlanTaskDetail,
  PlanTaskStatusInput,
  LocationUpdateRead,
  PlanGeoPoint,
} from "./types";
import { requestJson, ROUTE_REQUEST_TIMEOUT_MS } from "../../lib/api";

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const plansPath = `${apiBase}/api/admin/plans`;

async function request<T>(path: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  return requestJson<T>(path, init, { timeoutMs });
}

export function getPlanDays(dateFrom?: string, dateTo?: string): Promise<PlanDaysResponse> {
  const query = dateFrom && dateTo
    ? `?date_from=${encodeURIComponent(dateFrom)}&date_to=${encodeURIComponent(dateTo)}`
    : "";
  return request<PlanDaysResponse>(`${plansPath}/days${query}`);
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

interface LocationConcurrency {
  serviceDate: string;
  dayRevision: string;
}

export function updateTaskLocation(
  detail: PlanTaskDetail,
  position: PlanGeoPoint,
  concurrency: LocationConcurrency,
): Promise<LocationUpdateRead> {
  const common = {
    latitude: position.latitude,
    longitude: position.longitude,
    coordinate_system: "GCJ-02",
    service_date: concurrency.serviceDate,
    expected_day_revision: concurrency.dayRevision,
  };
  if (detail.location_scope === "customer" && detail.customer.id && detail.customer.updated_at) {
    return request<LocationUpdateRead>(`${apiBase}/api/admin/customers/${detail.customer.id}/location`, {
      method: "PATCH",
      body: JSON.stringify({
        ...common,
        source_order_id: detail.task.order_id,
        expected_customer_updated_at: detail.customer.updated_at,
      }),
    });
  }
  return request<LocationUpdateRead>(`${apiBase}/api/admin/orders/${detail.task.order_id}/location`, {
    method: "PATCH",
    body: JSON.stringify({ ...common, expected_order_updated_at: detail.order_updated_at }),
  });
}

export function restoreTaskAutomaticLocation(
  detail: PlanTaskDetail,
  concurrency: LocationConcurrency,
): Promise<LocationUpdateRead> {
  const common = {
    service_date: concurrency.serviceDate,
    expected_day_revision: concurrency.dayRevision,
  };
  if (detail.location_scope === "customer" && detail.customer.id && detail.customer.updated_at) {
    return request<LocationUpdateRead>(`${apiBase}/api/admin/customers/${detail.customer.id}/location/restore-auto`, {
      method: "POST",
      body: JSON.stringify({
        ...common,
        source_order_id: detail.task.order_id,
        expected_customer_updated_at: detail.customer.updated_at,
      }),
    });
  }
  return request<LocationUpdateRead>(`${apiBase}/api/admin/orders/${detail.task.order_id}/location/restore-auto`, {
    method: "POST",
    body: JSON.stringify({ ...common, expected_order_updated_at: detail.order_updated_at }),
  });
}
