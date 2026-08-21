import {
  completeTaskExecution,
  getTaskExecution,
  markTaskException,
  saveTaskText,
  startTaskExecution,
  taskPhotoUrl,
  updateTaskChecklist,
  uploadTaskPhoto,
} from "./api";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({}),
  } as Response));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("uses revision-protected execution endpoints and multipart photo upload", async () => {
  const revision = "a".repeat(64);
  const fetchMock = vi.mocked(fetch);
  const photo = new File(["synthetic"], "synthetic.png", { type: "image/png" });

  await getTaskExecution(7);
  await startTaskExecution(7, { expected_revision: revision });
  await updateTaskChecklist(7, 9, { expected_revision: revision, completed: true });
  await saveTaskText(7, {
    expected_revision: revision,
    notes: "虚构执行备注",
    cat_status: "虚构猫咪状态",
  });
  await uploadTaskPhoto(7, revision, photo);
  await completeTaskExecution(7, { expected_revision: revision });
  await markTaskException(7, {
    expected_revision: revision,
    exception_notes: "虚构异常说明",
  });

  expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/admin/tasks/7", expect.any(Object));
  expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/admin/tasks/7/start", expect.objectContaining({ method: "POST" }));
  expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/admin/tasks/7/items/9", expect.objectContaining({ method: "PATCH" }));
  expect(fetchMock).toHaveBeenNthCalledWith(4, "/api/admin/tasks/7/notes", expect.objectContaining({ method: "PUT" }));
  const photoCall = fetchMock.mock.calls[4];
  expect(photoCall?.[0]).toBe("/api/admin/tasks/7/photos");
  const photoInit = photoCall?.[1] as RequestInit;
  expect(photoInit.method).toBe("POST");
  expect(photoInit.body).toBeInstanceOf(FormData);
  expect((photoInit.body as FormData).get("expected_revision")).toBe(revision);
  expect((photoInit.body as FormData).get("photo")).toBe(photo);
  expect(new Headers(photoInit.headers).has("Content-Type")).toBe(false);
  expect(fetchMock).toHaveBeenNthCalledWith(6, "/api/admin/tasks/7/complete", expect.objectContaining({ method: "POST" }));
  expect(fetchMock).toHaveBeenNthCalledWith(7, "/api/admin/tasks/7/exception", expect.objectContaining({ method: "POST" }));
  expect(taskPhotoUrl("/api/admin/tasks/7/photos/1")).toBe("/api/admin/tasks/7/photos/1");
});
