import type { PaymentCreateInput, PaymentRegistration, PaymentsOverview } from "./types";
import { requestJson } from "../../lib/api";

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const paymentsPath = `${apiBase}/api/admin/payments`;

export class PaymentsApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "PaymentsApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return requestJson<T>(path, init, {
    errorFactory: (status, message) => new PaymentsApiError(status, message),
  });
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
