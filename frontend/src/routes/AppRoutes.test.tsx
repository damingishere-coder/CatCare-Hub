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
    ["/admin/tasks/7", "单次服务执行"],
    ["/admin/orders", "订单计划"],
    ["/admin/customers", "客户档案"],
    ["/admin/payments", "收款记录"],
    ["/admin/settings", "设置"],
  ])("renders admin route %s", (path, heading) => {
    renderRoute(path);

    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
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
