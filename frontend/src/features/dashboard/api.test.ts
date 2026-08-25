import { getDashboard, markTaskPhotosSent } from "./api";

const dashboardPayload = {
  business_date: "2035-10-06",
  month_start: "2035-10-01",
  metrics: {
    month_order_count: 0,
    pending_task_count: 0,
    pending_payment_count: 0,
    month_income: "0.00",
  },
  schedule: [],
  reminders: [],
};

beforeEach(() => {
  vi.restoreAllMocks();
});

it("loads a deterministic dashboard date without sensitive query data", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(dashboardPayload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );

  await getDashboard("2035-10-06");

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/admin/dashboard?date=2035-10-06",
    expect.objectContaining({ headers: expect.objectContaining({ Accept: "application/json" }) }),
  );
});

it("marks photos sent with JSON revision protection", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        task_id: 7,
        photos_sent_at: "2035-10-06T10:00:00Z",
        revision: "b".repeat(64),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );

  await markTaskPhotosSent(7, "a".repeat(64));

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/admin/dashboard/tasks/7/photos-sent",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ expected_revision: "a".repeat(64) }),
      headers: expect.objectContaining({ "Content-Type": "application/json" }),
    }),
  );
});
