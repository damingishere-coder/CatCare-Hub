import type {
  OrderDetail,
  OrderFormOptions,
  OrderInput,
  OrderListResponse,
  OrderStatus,
} from "./types";

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const ordersPath = `${apiBase}/api/admin/orders`;

interface ApiErrorPayload {
  detail?: string | Array<{ msg?: string }>;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
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
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
}

export function listOrders(): Promise<OrderListResponse> {
  return request<OrderListResponse>(ordersPath);
}

export function getOrder(orderId: number): Promise<OrderDetail> {
  return request<OrderDetail>(`${ordersPath}/${orderId}`);
}

export function getOrderFormOptions(): Promise<OrderFormOptions> {
  return request<OrderFormOptions>(`${ordersPath}/form-options`);
}

export function createOrder(payload: OrderInput): Promise<OrderDetail> {
  return request<OrderDetail>(ordersPath, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateOrder(orderId: number, payload: OrderInput): Promise<OrderDetail> {
  return request<OrderDetail>(`${ordersPath}/${orderId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function updateOrderStatus(
  orderId: number,
  orderStatus: OrderStatus,
): Promise<OrderDetail> {
  return request<OrderDetail>(`${ordersPath}/${orderId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ order_status: orderStatus }),
  });
}
