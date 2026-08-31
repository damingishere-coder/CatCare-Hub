import type {
  PaymentCreateInput,
  PaymentDeleteInput,
  PaymentMutationResult,
  PaymentRegistration,
  PaymentRestoreInput,
  PaymentVoidInput,
  PaymentVoidResult,
  PaymentsOverview,
} from "./types";
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

export function voidPayment(
  paymentId: number,
  payload: PaymentVoidInput,
): Promise<PaymentVoidResult> {
  return request<PaymentVoidResult>(`${paymentsPath}/${paymentId}/void`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deletePayment(
  paymentId: number,
  payload: PaymentDeleteInput,
): Promise<PaymentMutationResult> {
  return request<PaymentMutationResult>(`${paymentsPath}/${paymentId}/delete`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function restorePayment(
  paymentId: number,
  payload: PaymentRestoreInput,
): Promise<PaymentMutationResult> {
  return request<PaymentMutationResult>(`${paymentsPath}/${paymentId}/restore`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
