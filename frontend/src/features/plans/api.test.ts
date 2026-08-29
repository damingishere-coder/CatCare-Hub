import {
  getDayPlan,
  getPlanDays,
  getPlanRoute,
  getPlanTask,
  previewPlanRoute,
  restoreTaskAutomaticLocation,
  saveDaySchedule,
  updateTaskLocation,
  updatePlanTaskStatus,
} from "./api";
import type { PlanTaskDetail } from "./types";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

it("requests ranged calendar markers and revision-protected GCJ-02 location updates", async () => {
  const fetchMock = vi.mocked(fetch);
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
  const customerDetail = {
    task: { order_id: 9 },
    customer: { id: 4, updated_at: "2034-09-01T08:00:00Z" },
    location_scope: "customer",
  } as PlanTaskDetail;
  const orderDetail = {
    task: { order_id: 10 },
    customer: { id: null, updated_at: null },
    order_updated_at: "2034-09-02T08:00:00Z",
    location_scope: "order",
  } as PlanTaskDetail;

  await getPlanDays("2034-10-01", "2034-10-31");
  await updateTaskLocation(
    customerDetail,
    { latitude: 22.61, longitude: 114.05 },
    { serviceDate: "2034-10-01", dayRevision: "a".repeat(64) },
  );
  await restoreTaskAutomaticLocation(
    orderDetail,
    { serviceDate: "2034-10-02", dayRevision: "b".repeat(64) },
  );

  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    "/api/admin/plans/days?date_from=2034-10-01&date_to=2034-10-31",
    expect.any(Object),
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    "/api/admin/customers/4/location",
    expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({
        latitude: 22.61,
        longitude: 114.05,
        coordinate_system: "GCJ-02",
        service_date: "2034-10-01",
        expected_day_revision: "a".repeat(64),
        source_order_id: 9,
        expected_customer_updated_at: "2034-09-01T08:00:00Z",
      }),
    }),
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    3,
    "/api/admin/orders/10/location/restore-auto",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        service_date: "2034-10-02",
        expected_day_revision: "b".repeat(64),
        expected_order_updated_at: "2034-09-02T08:00:00Z",
      }),
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("uses dedicated day, task, schedule, and planning-status endpoints", async () => {
  const fetchMock = vi.mocked(fetch);
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) } as Response);

  await getPlanDays();
  await getDayPlan("2034-10-01");
  await getPlanTask(7);
  await saveDaySchedule("2034-10-01", {
    expected_revision: "a".repeat(64),
    tasks: [{ task_id: 7, planned_time: "09:30" }],
  });
  await updatePlanTaskStatus(7, {
    expected_revision: "b".repeat(64),
    task_status: "ready",
  });
  await getPlanRoute("2034-10-01");
  await previewPlanRoute("2034-10-01", {
    expected_revision: "c".repeat(64),
    geocode_missing: true,
  });

  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    "/api/admin/plans/days",
    expect.objectContaining({ headers: expect.objectContaining({ Accept: "application/json" }) }),
  );
  expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/admin/plans/2034-10-01", expect.any(Object));
  expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/admin/plans/tasks/7", expect.any(Object));
  expect(fetchMock).toHaveBeenNthCalledWith(
    4,
    "/api/admin/plans/2034-10-01/schedule",
    expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({
        expected_revision: "a".repeat(64),
        tasks: [{ task_id: 7, planned_time: "09:30" }],
      }),
    }),
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    5,
    "/api/admin/plans/tasks/7/status",
    expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({
        expected_revision: "b".repeat(64),
        task_status: "ready",
      }),
    }),
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    6,
    "/api/admin/plans/2034-10-01/route",
    expect.any(Object),
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    7,
    "/api/admin/plans/2034-10-01/route/preview",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        expected_revision: "c".repeat(64),
        geocode_missing: true,
      }),
    }),
  );
});

it("allows route preview up to 45 seconds before timing out", async () => {
  vi.useFakeTimers();
  vi.mocked(fetch).mockImplementation((_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }));

  const request = previewPlanRoute("2034-10-01", {
    expected_revision: "c".repeat(64),
    geocode_missing: true,
  });
  const assertion = expect(request).rejects.toThrow("请求已等待 45 秒仍未完成");
  await vi.advanceTimersByTimeAsync(45_000);
  await assertion;
});
