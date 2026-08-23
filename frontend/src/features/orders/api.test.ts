import { createOrder } from "./api";
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
    notes: null,
  };

  await createOrder(payload);

  const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
  const body = JSON.parse(String(request.body)) as Record<string, unknown>;
  expect(request.method).toBe("POST");
  expect(body).toEqual(payload);
  expect(body).not.toHaveProperty("total_amount");
});
