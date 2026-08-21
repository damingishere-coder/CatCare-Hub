import {
  getDayPlan,
  getPlanDays,
  getPlanTask,
  saveDaySchedule,
  updatePlanTaskStatus,
} from "./api";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
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
});
