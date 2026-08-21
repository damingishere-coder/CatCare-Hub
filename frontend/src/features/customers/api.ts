import type {
  CatDetail,
  CatInput,
  CustomerDetail,
  CustomerInput,
  CustomerListResponse,
} from "./types";

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const customersPath = `${apiBase}/api/admin/customers`;

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

export function listCustomers(search = ""): Promise<CustomerListResponse> {
  if (search) {
    return request<CustomerListResponse>(`${customersPath}/search`, {
      method: "POST",
      body: JSON.stringify({ search }),
    });
  }
  return request<CustomerListResponse>(customersPath);
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
