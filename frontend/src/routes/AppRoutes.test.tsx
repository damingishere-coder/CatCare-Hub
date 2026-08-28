import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { AppRoutes } from "./AppRoutes";

vi.mock("../features/tasks/TaskExecutionPage", () => ({
  TaskExecutionPage: () => <h1>单次服务执行</h1>,
}));

vi.mock("../features/dashboard/DashboardPage", () => ({
  DashboardPage: () => <h1>工作台</h1>,
}));

vi.mock("../features/payments/PaymentsPage", () => ({
  PaymentsPage: () => <h1>收款记录</h1>,
}));

vi.mock("../pages/MobilePage", () => ({
  MobilePage: () => <h1>今天的喂猫任务</h1>,
}));

vi.mock("../features/mobile/MobileTaskPage", () => ({
  MobileTaskPage: () => <h1>单次喂猫任务</h1>,
}));

vi.mock("../features/intake/AdminIntakePage", () => ({
  AdminIntakePage: () => <h1>客户填写</h1>,
}));

vi.mock("../features/plans/PlansPage", () => ({
  PlansPage: () => <h1>路线图</h1>,
}));

vi.mock("../features/orders/OrdersPage", () => ({
  OrdersPage: () => <h1>订单管理</h1>,
}));

vi.mock("../features/customers/CustomersPage", () => ({
  CustomersPage: () => <h1>客户档案</h1>,
}));

vi.mock("../pages/admin/AdminPages", () => ({
  SettingsPage: () => <h1>设置</h1>,
}));

function renderRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe("P0 application routes", () => {
  it("renders the dashboard and the six admin navigation items in business order", () => {
    renderRoute("/admin");

    expect(
      screen.getByRole("heading", { name: "工作台" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "后台主导航" }),
    ).toBeInTheDocument();

    const expectedLabels = [
      "工作台",
      "订单管理",
      "路线图",
      "收款记录",
      "客户档案",
      "设置",
    ];
    for (const label of expectedLabels) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
    expect(
      screen.getAllByRole("link").map((link) => link.textContent?.trim()),
    ).toEqual(expectedLabels);
  });

  it("redirects the retired login route directly to the dashboard", async () => {
    renderRoute("/login");

    expect(await screen.findByRole("heading", { name: "工作台" })).toBeInTheDocument();
  });

  it.each([
    ["/admin/routes", "路线图"],
    ["/admin/plans", "路线图"],
    ["/admin/tasks/7", "单次服务执行"],
    ["/admin/orders", "订单管理"],
    ["/admin/customers", "客户档案"],
    ["/admin/intake", "客户填写"],
    ["/admin/payments", "收款记录"],
    ["/admin/settings", "设置"],
  ])("renders admin route %s", async (path, heading) => {
    renderRoute(path);

    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
  });

  it("keeps the orders alias focused on the combined order-management view", async () => {
    renderRoute("/admin/orders");

    expect(
      await screen.findByRole("heading", { name: "订单管理" }),
    ).toBeInTheDocument();
  });

  it("renders the lightweight mobile routes", () => {
    renderRoute("/mobile");

    expect(
      screen.getByRole("heading", { name: "今天的喂猫任务" }),
    ).toBeInTheDocument();

    renderRoute("/mobile/tasks/7");
    expect(
      screen.getByRole("heading", { name: "单次喂猫任务" }),
    ).toBeInTheDocument();
  });

  it.each(["/f", "/fill"])("rejects the tokenless customer fill entry %s clearly", (path) => {
    renderRoute(path);
    expect(screen.getByText(/当前链接缺少专属 Token/)).toBeInTheDocument();
  });

  it("renders a clear not-found page", () => {
    renderRoute("/not-a-real-page");

    expect(
      screen.getByRole("heading", { name: "页面不存在" }),
    ).toBeInTheDocument();
  });
});
