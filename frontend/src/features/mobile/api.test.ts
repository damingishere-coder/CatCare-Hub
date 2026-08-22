import { getMobileToday } from "./api";

beforeEach(() => {
  vi.restoreAllMocks();
});

it("turns an offline fetch failure into a clear mobile message", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

  await expect(getMobileToday()).rejects.toMatchObject({
    name: "MobileApiError",
    status: 0,
    message: "当前网络不可用，任务数据需要联网加载。",
  });
});
