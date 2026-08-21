import { listCustomers } from "./api";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("sends customer search terms in a JSON body instead of the URL", async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ items: [], total: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );

  await listCustomers("TEST-PHONE");

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/admin/customers/search",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ search: "TEST-PHONE" }),
    }),
  );
  expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("TEST-PHONE");
});
