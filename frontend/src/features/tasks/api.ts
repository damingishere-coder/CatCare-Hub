import type {
  TaskChecklistInput,
  TaskExceptionInput,
  TaskExecutionDetail,
  TaskRevisionInput,
  TaskTextInput,
} from "./types";
import { requestJson, UPLOAD_REQUEST_TIMEOUT_MS } from "../../lib/api";

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const tasksPath = `${apiBase}/api/admin/tasks`;

export class TaskApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "TaskApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  return requestJson<T>(path, init, {
    timeoutMs,
    errorFactory: (status, message) => new TaskApiError(status, message),
  });
}

export function getTaskExecution(taskId: number): Promise<TaskExecutionDetail> {
  return request<TaskExecutionDetail>(`${tasksPath}/${taskId}`);
}

export function startTaskExecution(
  taskId: number,
  payload: TaskRevisionInput,
): Promise<TaskExecutionDetail> {
  return request<TaskExecutionDetail>(`${tasksPath}/${taskId}/start`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateTaskChecklist(
  taskId: number,
  itemId: number,
  payload: TaskChecklistInput,
): Promise<TaskExecutionDetail> {
  return request<TaskExecutionDetail>(`${tasksPath}/${taskId}/items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function saveTaskText(
  taskId: number,
  payload: TaskTextInput,
): Promise<TaskExecutionDetail> {
  return request<TaskExecutionDetail>(`${tasksPath}/${taskId}/notes`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function uploadTaskPhoto(
  taskId: number,
  expectedRevision: string,
  photo: File,
): Promise<TaskExecutionDetail> {
  const form = new FormData();
  form.append("expected_revision", expectedRevision);
  form.append("photo", photo);
  return request<TaskExecutionDetail>(
    `${tasksPath}/${taskId}/photos`,
    {
      method: "POST",
      body: form,
    },
    UPLOAD_REQUEST_TIMEOUT_MS,
  );
}

export function completeTaskExecution(
  taskId: number,
  payload: TaskRevisionInput,
): Promise<TaskExecutionDetail> {
  return request<TaskExecutionDetail>(`${tasksPath}/${taskId}/complete`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function markTaskException(
  taskId: number,
  payload: TaskExceptionInput,
): Promise<TaskExecutionDetail> {
  return request<TaskExecutionDetail>(`${tasksPath}/${taskId}/exception`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function taskPhotoUrl(url: string): string {
  return url.startsWith("/") ? `${apiBase}${url}` : url;
}
