import {
  createOrder,
  deleteOrder,
  retryOrderGeocode,
  updateOrder,
  updateOrderStatus,
} from "./api";
import type { OrderInput } from "./types";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("posts only order inputs and leaves the authoritative total to the backend", async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ id: 1 }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }),
  );
  const payload: OrderInput = {
    source_customer_id: 1,
    service_contact: {
      name: "测试联系人",
      wechat_name: null,
      phone: null,
      community: null,
      address: null,
      building: null,
      unit: null,
      room: null,
      access_method: null,
      access_info: null,
      key_status: null,
      key_code: null,
      notes: null,
      is_repeat_customer: false,
      latitude: null,
      longitude: null,
      geocode_status: null,
    },
    cat_snapshot: [],
    cat_count: 2,
    service_dates: ["2030-10-01", "2030-10-07"],
    service_items: ["feed"],
    unit_price: "30.00",
    settlement_mode: "daily",
    amount_adjustment: { type: "none", amount: "0.00", reason: null, service_date: null },
    notes: null,
  };

  await createOrder(payload, "order-create-test-key");

  const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
  const body = JSON.parse(String(request.body)) as Record<string, unknown>;
  expect(request.method).toBe("POST");
  expect(request.headers).toEqual(
    expect.objectContaining({ "Idempotency-Key": "order-create-test-key" }),
  );
  expect(body).toEqual(payload);
  expect(body).not.toHaveProperty("total_amount");
});

it.each([
  ["updates an order", () => updateOrder(7, { notes: "更新" }, "b".repeat(64)), "PATCH"],
  [
    "updates order status",
    () => updateOrderStatus(7, "confirmed", "b".repeat(64)),
    "PATCH",
  ],
  ["retries geocoding", () => retryOrderGeocode(7, "b".repeat(64)), "POST"],
  ["deletes an order", () => deleteOrder(7, "b".repeat(64)), "DELETE"],
])("%s with If-Match", async (_label, action, method) => {
  fetchMock.mockResolvedValue(
    method === "DELETE"
      ? new Response(null, { status: 204 })
      : new Response(JSON.stringify({ id: 7 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
  );

  await action();

  const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
  expect(request.method).toBe(method);
  expect(request.headers).toEqual(
    expect.objectContaining({ "If-Match": "b".repeat(64) }),
  );
});
