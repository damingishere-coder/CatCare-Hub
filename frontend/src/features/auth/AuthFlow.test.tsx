import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { unauthorizedEventName } from "../../lib/authEvents";
import { AuthProvider } from "./AuthProvider";
import { LoginPage } from "./LoginPage";
import { RequireRole } from "./RequireRole";


function jsonResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderAuthFlow(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireRole allowed={["admin"]} />}>
            <Route path="/admin" element={<h1>受保护的管理后台</h1>} />
          </Route>
          <Route element={<RequireRole allowed={["admin", "mobile"]} />}>
            <Route path="/mobile" element={<h1>受保护的执行端</h1>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("redirects an anonymous admin deep link to login and returns after success", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse({ detail: "请先登录" }, 401))
    .mockResolvedValueOnce(jsonResponse({ role: "admin", expires_at: "2035-01-01T00:00:00Z" }));
  vi.stubGlobal("fetch", fetchMock);
  const storageSpy = vi.spyOn(Storage.prototype, "setItem");
  renderAuthFlow("/admin");

  expect(await screen.findByRole("heading", { name: "使用访问码登录" })).toBeInTheDocument();
  expect(screen.getByLabelText("管理后台")).toBeChecked();
  fireEvent.change(screen.getByLabelText("访问码"), { target: { value: "local-admin-code" } });
  fireEvent.click(screen.getByRole("button", { name: "安全登录" }));

  expect(await screen.findByRole("heading", { name: "受保护的管理后台" })).toBeInTheDocument();
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    "/api/auth/login",
    expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      body: JSON.stringify({ role: "admin", access_code: "local-admin-code" }),
    }),
  );
  expect(storageSpy).not.toHaveBeenCalled();
});

it("blocks a mobile session from the admin route", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      jsonResponse({ role: "mobile", expires_at: "2035-01-01T00:00:00Z" }),
    ),
  );
  renderAuthFlow("/admin");

  expect(await screen.findByRole("heading", { name: "当前账号没有此页面权限" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "返回执行端" })).toHaveAttribute("href", "/mobile");
});

it("returns to login when a protected API reports an expired session", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      jsonResponse({ role: "admin", expires_at: "2035-01-01T00:00:00Z" }),
    ),
  );
  renderAuthFlow("/admin");
  expect(await screen.findByRole("heading", { name: "受保护的管理后台" })).toBeInTheDocument();

  window.dispatchEvent(new Event(unauthorizedEventName));
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "使用访问码登录" })).toBeInTheDocument();
  });
});
