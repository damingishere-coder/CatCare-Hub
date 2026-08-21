import { getPaymentsOverview, registerPayment } from "./api";

const overview = {
  business_date: "2035-10-06",
  month_start: "2035-10-01",
  metrics: {
    today_income: "0.00",
    pending_order_count: 0,
    month_income: "0.00",
    completed_order_count: 0,
  },
  receivables: [],
  records: [],
};

beforeEach(() => {
  vi.restoreAllMocks();
});

it("loads a deterministic payments overview date", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(overview), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );

  await getPaymentsOverview("2035-10-06");

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/admin/payments?date=2035-10-06",
    expect.objectContaining({ headers: expect.objectContaining({ Accept: "application/json" }) }),
  );
});

it("registers a completed payment using the order revision", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ payment: {}, order: {} }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }),
  );
  const payload = {
    order_id: 12,
    amount: "10.00",
    payment_method: "wechat" as const,
    paid_at: "2035-10-06T01:30:00.000Z",
    notes: null,
    expected_revision: "a".repeat(64),
  };

  await registerPayment(payload);

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/admin/payments",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify(payload),
      headers: expect.objectContaining({ "Content-Type": "application/json" }),
    }),
  );
});
