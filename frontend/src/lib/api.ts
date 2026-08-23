export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const ROUTE_REQUEST_TIMEOUT_MS = 45_000;
export const UPLOAD_REQUEST_TIMEOUT_MS = 60_000;

interface ApiErrorPayload {
  detail?: string | { message?: string } | Array<{ msg?: string }>;
}

export type ApiFailureKind = "network" | "timeout" | "http";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly kind: ApiFailureKind;

  constructor(status: number, message: string, kind: ApiFailureKind) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.kind = kind;
  }
}

type ErrorFactory = (status: number, message: string) => Error;

export interface RequestOptions {
  timeoutMs?: number;
  errorFactory?: ErrorFactory;
  networkMessage?: string;
}

function makeError(
  status: number,
  message: string,
  kind: ApiFailureKind,
  errorFactory?: ErrorFactory,
): Error {
  return errorFactory?.(status, message) ?? new ApiRequestError(status, message, kind);
}

function timeoutLabel(timeoutMs: number): string {
  return timeoutMs % 1000 === 0 ? `${timeoutMs / 1000} 秒` : `${timeoutMs} 毫秒`;
}

export async function requestJson<T>(
  path: string,
  init?: RequestInit,
  options: RequestOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  init?.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const timeoutError = () => makeError(
    0,
    `请求已等待 ${timeoutLabel(timeoutMs)}仍未完成，请检查服务状态后重试。`,
    "timeout",
    options.errorFactory,
  );

  const hasJsonBody = Boolean(init?.body) && !(init?.body instanceof FormData);
  try {
    let response: Response;
    try {
      response = await fetch(path, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
          ...init?.headers,
        },
      });
    } catch (cause) {
      if (timedOut) throw timeoutError();
      if (init?.signal?.aborted) throw cause;
      throw makeError(
        0,
        options.networkMessage ?? "无法连接 CatCare 服务，请确认项目仍在运行，然后重试。",
        "network",
        options.errorFactory,
      );
    }

    if (!response.ok) {
      let message = `服务返回错误（HTTP ${response.status}），请重试。`;
      try {
        const payload = (await response.json()) as ApiErrorPayload;
        if (typeof payload.detail === "string") {
          message = payload.detail;
        } else if (payload.detail && !Array.isArray(payload.detail)) {
          message = payload.detail.message || message;
        } else if (Array.isArray(payload.detail)) {
          message = payload.detail.map((item) => item.msg).filter(Boolean).join("；") || message;
        }
      } catch {
        if (timedOut) throw timeoutError();
        // Non-JSON responses retain the status-specific Chinese fallback.
      }
      throw makeError(response.status, message, "http", options.errorFactory);
    }

    if (response.status === 204) return undefined as T;
    try {
      return (await response.json()) as T;
    } catch (cause) {
      if (timedOut) throw timeoutError();
      throw cause;
    }
  } finally {
    window.clearTimeout(timeoutId);
    init?.signal?.removeEventListener("abort", abortFromCaller);
  }
}
