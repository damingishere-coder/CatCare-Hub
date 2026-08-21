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
    customer_id: 1,
    cat_ids: [1, 2],
    start_date: "2030-10-01",
    end_date: "2030-10-07",
    visits_per_day: 1,
    service_items: ["feed"],
    base_price: "30.00",
    stairs_fee: "0.00",
    other_fee: "0.00",
    order_status: "pending_confirmation",
    notes: null,
  };

  await createOrder(payload);

  const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
  const body = JSON.parse(String(request.body)) as Record<string, unknown>;
  expect(request.method).toBe("POST");
  expect(body).toEqual(payload);
  expect(body).not.toHaveProperty("total_amount");
});
