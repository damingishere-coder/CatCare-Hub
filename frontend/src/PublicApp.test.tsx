import { render, screen } from "@testing-library/react";

import { PublicApp } from "./PublicApp";

vi.mock("./pages/FillPage", () => ({
  FillPage: ({ token }: { token: string | null }) => (
    <p>公开填写 Token：{token ?? "缺失"}</p>
  ),
}));

function renderPath(path: string) {
  window.history.replaceState({}, "", path);
  return render(<PublicApp />);
}

it.each([
  ["/f/short-token_123", "short-token_123"],
  ["/fill/legacy-token_456", "legacy-token_456"],
  ["/f/short-token_123/", "short-token_123"],
])("parses supported public path %s", (path, token) => {
  renderPath(path);
  expect(screen.getByText(`公开填写 Token：${token}`)).toBeInTheDocument();
});

it.each(["/f", "/fill/"])("shows the missing-token state for %s", (path) => {
  renderPath(path);
  expect(screen.getByText("公开填写 Token：缺失")).toBeInTheDocument();
});

it("rejects paths outside the public form allowlist", () => {
  renderPath("/admin");
  expect(screen.getByRole("heading", { name: "填写链接无效" })).toBeInTheDocument();
});
