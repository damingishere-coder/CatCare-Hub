import type {
  CatDetail,
  CatInput,
  CustomerDetail,
  CustomerInput,
  CustomerListResponse,
} from "./types";
import { requestJson } from "../../lib/api";

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const customersPath = `${apiBase}/api/admin/customers`;

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

export function listCustomers(search = "", includeArchived = false): Promise<CustomerListResponse> {
  if (search) {
    return request<CustomerListResponse>(`${customersPath}/search`, {
      method: "POST",
      body: JSON.stringify({ search, include_archived: includeArchived }),
    });
  }
  return request<CustomerListResponse>(includeArchived ? `${customersPath}?include_archived=true` : customersPath);
}

export function getCustomer(customerId: number): Promise<CustomerDetail> {
  return request<CustomerDetail>(`${customersPath}/${customerId}`);
}

export function createCustomer(payload: CustomerInput): Promise<CustomerDetail> {
  return request<CustomerDetail>(customersPath, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateCustomer(
  customerId: number,
  payload: CustomerInput,
): Promise<CustomerDetail> {
  return request<CustomerDetail>(`${customersPath}/${customerId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function createCat(customerId: number, payload: CatInput): Promise<CatDetail> {
  return request<CatDetail>(`${customersPath}/${customerId}/cats`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateCat(
  customerId: number,
  catId: number,
  payload: Partial<CatInput> & { is_active?: boolean },
): Promise<CatDetail> {
  return request<CatDetail>(`${customersPath}/${customerId}/cats/${catId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function archiveCustomer(customerId: number, archived: boolean): Promise<CustomerDetail> {
  return request<CustomerDetail>(`${customersPath}/${customerId}/archive`, {
    method: "PATCH",
    body: JSON.stringify({ archived }),
  });
}

export function deleteCustomer(customerId: number): Promise<void> {
  return request<void>(`${customersPath}/${customerId}`, { method: "DELETE" });
}
