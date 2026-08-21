import type {
  TaskChecklistInput,
  TaskExceptionInput,
  TaskExecutionDetail,
  TaskRevisionInput,
  TaskTextInput,
} from "./types";

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const tasksPath = `${apiBase}/api/admin/tasks`;

interface ApiErrorPayload {
  detail?: string | Array<{ msg?: string }>;
}

export class TaskApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "TaskApiError";
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
    throw new TaskApiError(response.status, message);
  }
  return (await response.json()) as T;
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
  return request<TaskExecutionDetail>(`${tasksPath}/${taskId}/photos`, {
    method: "POST",
    body: form,
  });
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
