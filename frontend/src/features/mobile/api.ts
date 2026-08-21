import type {
  TaskChecklistInput,
  TaskRevisionInput,
  TaskTextInput,
} from "../tasks/types";
import type { MobileTaskExecutionDetail, MobileTodayRead } from "./types";

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const mobilePath = `${apiBase}/api/mobile`;

interface ApiErrorPayload {
  detail?: string | Array<{ msg?: string }>;
}

export class MobileApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "MobileApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const hasJsonBody = Boolean(init?.body) && !(init?.body instanceof FormData);
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let message = `请求失败（HTTP ${response.status}）`;
    try {
      const payload = (await response.json()) as ApiErrorPayload;
      if (typeof payload.detail === "string") {
        message = payload.detail;
      } else if (Array.isArray(payload.detail)) {
        message = payload.detail.map((item) => item.msg).filter(Boolean).join("；") || message;
      }
    } catch {
      // Keep the HTTP fallback for a non-JSON response.
    }
    throw new MobileApiError(response.status, message);
  }
  return (await response.json()) as T;
}

export function getMobileToday(): Promise<MobileTodayRead> {
  return request<MobileTodayRead>(`${mobilePath}/today`);
}

export function getMobileTask(taskId: number): Promise<MobileTaskExecutionDetail> {
  return request<MobileTaskExecutionDetail>(`${mobilePath}/tasks/${taskId}`);
}

export function startMobileTask(
  taskId: number,
  payload: TaskRevisionInput,
): Promise<MobileTaskExecutionDetail> {
  return request<MobileTaskExecutionDetail>(`${mobilePath}/tasks/${taskId}/start`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateMobileChecklist(
  taskId: number,
  itemId: number,
  payload: TaskChecklistInput,
): Promise<MobileTaskExecutionDetail> {
  return request<MobileTaskExecutionDetail>(`${mobilePath}/tasks/${taskId}/items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function saveMobileTaskText(
  taskId: number,
  payload: TaskTextInput,
): Promise<MobileTaskExecutionDetail> {
  return request<MobileTaskExecutionDetail>(`${mobilePath}/tasks/${taskId}/notes`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function uploadMobileTaskPhoto(
  taskId: number,
  expectedRevision: string,
  photo: File,
): Promise<MobileTaskExecutionDetail> {
  const form = new FormData();
  form.append("expected_revision", expectedRevision);
  form.append("photo", photo);
  return request<MobileTaskExecutionDetail>(`${mobilePath}/tasks/${taskId}/photos`, {
    method: "POST",
    body: form,
  });
}

export function completeMobileTask(
  taskId: number,
  payload: TaskRevisionInput,
): Promise<MobileTaskExecutionDetail> {
  return request<MobileTaskExecutionDetail>(`${mobilePath}/tasks/${taskId}/complete`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function mobilePhotoUrl(url: string): string {
  return url.startsWith("/") ? `${apiBase}${url}` : url;
}
