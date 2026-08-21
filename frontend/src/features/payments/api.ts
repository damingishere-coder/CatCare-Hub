import type { PaymentCreateInput, PaymentRegistration, PaymentsOverview } from "./types";

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const paymentsPath = `${apiBase}/api/admin/payments`;

interface ApiErrorPayload {
  detail?: string | Array<{ msg?: string }>;
}

export class PaymentsApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "PaymentsApiError";
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
    throw new PaymentsApiError(response.status, message);
  }
  return (await response.json()) as T;
}

export function getPaymentsOverview(businessDate?: string): Promise<PaymentsOverview> {
  const query = businessDate ? `?${new URLSearchParams({ date: businessDate })}` : "";
  return request<PaymentsOverview>(`${paymentsPath}${query}`);
}

export function registerPayment(payload: PaymentCreateInput): Promise<PaymentRegistration> {
  return request<PaymentRegistration>(paymentsPath, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
