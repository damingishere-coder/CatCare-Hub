import type {
  TaskChecklistInput,
  TaskRevisionInput,
  TaskTextInput,
} from "../tasks/types";
import type { MobileTaskExecutionDetail, MobileTodayRead } from "./types";
import { requestJson, UPLOAD_REQUEST_TIMEOUT_MS } from "../../lib/api";

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const mobilePath = `${apiBase}/api/mobile`;

export class MobileApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "MobileApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  return requestJson<T>(path, init, {
    timeoutMs,
    errorFactory: (status, message) => new MobileApiError(status, message),
    networkMessage: "当前网络不可用，任务数据需要联网加载。",
  });
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
  return request<MobileTaskExecutionDetail>(
    `${mobilePath}/tasks/${taskId}/photos`,
    {
      method: "POST",
      body: form,
    },
    UPLOAD_REQUEST_TIMEOUT_MS,
  );
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
