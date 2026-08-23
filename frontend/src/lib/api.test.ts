import { ApiRequestError, requestJson } from "./api";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("turns a disconnected fetch into a Chinese network error", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

  await expect(requestJson("/api/test")).rejects.toMatchObject({
    name: "ApiRequestError",
    status: 0,
    kind: "network",
    message: "无法连接 CatCare 服务，请确认项目仍在运行，然后重试。",
  } satisfies Partial<ApiRequestError>);
});

it("aborts a local read after the configured timeout", async () => {
  vi.useFakeTimers();
  vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }));

  const request = requestJson("/api/slow", undefined, { timeoutMs: 15_000 });
  const assertion = expect(request).rejects.toMatchObject({
    status: 0,
    kind: "timeout",
    message: "请求已等待 15 秒仍未完成，请检查服务状态后重试。",
  });
  await vi.advanceTimersByTimeAsync(15_000);
  await assertion;
});

it("keeps an HTTP response distinct from network failures", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
    JSON.stringify({ detail: "数据库版本落后，请先完成迁移。" }),
    { status: 503, headers: { "Content-Type": "application/json" } },
  ));

  await expect(requestJson("/api/ready")).rejects.toMatchObject({
    status: 503,
    kind: "http",
    message: "数据库版本落后，请先完成迁移。",
  });
});
