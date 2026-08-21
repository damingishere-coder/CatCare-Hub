import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { AppRoutes } from "./AppRoutes";

function renderRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe("P0 application routes", () => {
  it("renders the dashboard and all five admin navigation items", () => {
    renderRoute("/admin");

    expect(
      screen.getByRole("heading", { name: "工作台" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "后台主导航" }),
    ).toBeInTheDocument();

    for (const label of [
      "工作台",
      "订单计划",
      "客户档案",
      "收款记录",
      "设置",
    ]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it.each([
    ["/admin/plans", "订单计划"],
    ["/admin/customers", "客户档案"],
    ["/admin/payments", "收款记录"],
    ["/admin/settings", "设置"],
  ])("renders admin route %s", (path, heading) => {
    renderRoute(path);

    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
  });

  it("renders the lightweight mobile entry", () => {
    renderRoute("/mobile");

    expect(
      screen.getByRole("heading", { name: "手机执行端" }),
    ).toBeInTheDocument();
  });

  it("distinguishes a token fill link from the tokenless entry", () => {
    const view = renderRoute("/fill/P0-test-token");
    expect(
      screen.getByText(/填写链接格式已识别/),
    ).toBeInTheDocument();

    view.unmount();
    renderRoute("/fill");
    expect(screen.getByText(/缺少专属 Token/)).toBeInTheDocument();
  });

  it("renders a clear not-found page", () => {
    renderRoute("/not-a-real-page");

    expect(
      screen.getByRole("heading", { name: "页面不存在" }),
    ).toBeInTheDocument();
  });
});
