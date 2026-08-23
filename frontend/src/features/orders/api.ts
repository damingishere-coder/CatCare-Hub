import type {
  OrderCreateInput,
  OrderDetail,
  OrderFormOptions,
  OrderListResponse,
  OrderPatchInput,
  OrderStatus,
} from "./types";
import { requestJson } from "../../lib/api";

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const ordersPath = `${apiBase}/api/admin/orders`;

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return requestJson<T>(path, init, {
    errorFactory: (status, message) => new ApiError(status, message),
  });
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

export function createOrder(payload: OrderCreateInput): Promise<OrderDetail> {
  return request<OrderDetail>(ordersPath, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateOrder(orderId: number, payload: OrderPatchInput): Promise<OrderDetail> {
  return request<OrderDetail>(`${ordersPath}/${orderId}`, {
    method: "PATCH",
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

export function deleteOrder(orderId: number): Promise<void> {
  return request<void>(`${ordersPath}/${orderId}`, { method: "DELETE" });
}

export function retryOrderGeocode(orderId: number): Promise<OrderDetail> {
  return request<OrderDetail>(`${ordersPath}/${orderId}/geocode`, { method: "POST" });
}

export interface DemoDataCounts {
  customers: number;
  cats: number;
  orders: number;
  tasks: number;
  payments: number;
}

export interface DemoDataPreview {
  system_key: "catcare-demo-seed-v1";
  already_cleared: boolean;
  counts: DemoDataCounts;
}

export function previewDemoData(): Promise<DemoDataPreview> {
  return request<DemoDataPreview>(`${apiBase}/api/admin/settings/demo-data`);
}

export function clearDemoData(): Promise<DemoDataPreview & { cleared: boolean }> {
  return request(`${apiBase}/api/admin/settings/demo-data/clear`, {
    method: "POST",
    body: JSON.stringify({
      system_key: "catcare-demo-seed-v1",
      confirmation: "永久清除演示数据",
    }),
  });
}
