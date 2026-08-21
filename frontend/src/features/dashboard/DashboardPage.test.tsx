import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { DashboardPage } from "./DashboardPage";
import type { DashboardResponse } from "./types";

const apiMocks = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  markTaskPhotosSent: vi.fn(),
}));

vi.mock("./api", () => apiMocks);

const dashboard: DashboardResponse = {
  business_date: "2035-10-06",
  month_start: "2035-10-01",
  metrics: {
    today_order_count: 2,
    pending_task_count: 1,
    pending_payment_count: 3,
    month_income: "4860.00",
  },
  schedule: [
    {
      id: 7,
      order_id: 3,
      planned_time: "09:30:00",
      sort_order: 0,
      status: "in_progress",
      customer_name: "P7 工作台客户（虚构）",
      community: "P7 虚构小区",
      cat_count: 2,
    },
  ],
  reminders: [
    {
      id: "photos_pending:task:7",
      kind: "photos_pending",
      customer_name: "P7 工作台客户（虚构）",
      message: "09:30 · P7 工作台客户（虚构），现场照片尚未标记发送",
      task_id: 7,
      order_id: 3,
      cat_count: 2,
      amount: null,
      expected_revision: "a".repeat(64),
    },
    {
      id: "payment_due:order:8",
      kind: "payment_due",
      customer_name: "P7 待收客户（虚构）",
      message: "订单 #8 待收 120.00 元",
      task_id: null,
      order_id: 8,
      cat_count: 1,
      amount: "120.00",
      expected_revision: null,
    },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  apiMocks.getDashboard.mockResolvedValue(dashboard);
  apiMocks.markTaskPhotosSent.mockResolvedValue({
    task_id: 7,
    photos_sent_at: "2035-10-06T10:00:00Z",
    revision: "b".repeat(64),
  });
});

it("shows real metrics, schedule, reminders, and working quick links", async () => {
  renderPage();

  expect(await screen.findByRole("heading", { name: "工作台" })).toBeInTheDocument();
  const todayCard = screen.getByText("今日订单").closest("article");
  const incomeCard = screen.getByText("本月收入").closest("article");
  expect(todayCard).not.toBeNull();
  expect(incomeCard).not.toBeNull();
  expect(within(todayCard as HTMLElement).getByText("2")).toBeInTheDocument();
  expect(within(incomeCard as HTMLElement).getByText("¥4,860.00")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /P7 工作台客户/ })).toHaveAttribute(
    "href",
    "/admin/tasks/7",
  );
  expect(screen.getByText("待发送照片")).toBeInTheDocument();
  expect(screen.getAllByText("待收款").length).toBeGreaterThanOrEqual(2);
  expect(screen.getByRole("link", { name: "新增订单" })).toHaveAttribute(
    "href",
    "/admin/plans?view=orders&action=create",
  );
  expect(screen.getByRole("link", { name: "新增客户" })).toHaveAttribute(
    "href",
    "/admin/customers?action=create",
  );
  expect(screen.getByRole("link", { name: /客户填写入口/ })).toHaveAttribute("href", "/fill");
});

it("confirms a photo delivery marker and refreshes the dashboard", async () => {
  apiMocks.getDashboard
    .mockResolvedValueOnce(dashboard)
    .mockResolvedValueOnce({
      ...dashboard,
      reminders: dashboard.reminders.filter((item) => item.kind !== "photos_pending"),
    });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  renderPage();

  fireEvent.click(await screen.findByRole("button", { name: "标记已发送" }));

  await waitFor(() =>
    expect(apiMocks.markTaskPhotosSent).toHaveBeenCalledWith(7, "a".repeat(64)),
  );
  await waitFor(() => expect(screen.queryByText("待发送照片")).not.toBeInTheDocument());
  expect(apiMocks.getDashboard).toHaveBeenCalledTimes(2);
});

it("recovers from an API error and shows clean empty states", async () => {
  apiMocks.getDashboard.mockRejectedValueOnce(new Error("P7 虚构加载失败"));
  renderPage();

  expect(await screen.findByRole("alert")).toHaveTextContent("P7 虚构加载失败");
  apiMocks.getDashboard.mockResolvedValueOnce({
    ...dashboard,
    metrics: {
      today_order_count: 0,
      pending_task_count: 0,
      pending_payment_count: 0,
      month_income: "0.00",
    },
    schedule: [],
    reminders: [],
  });
  fireEvent.click(screen.getByRole("button", { name: "刷新" }));

  expect(await screen.findByText("今天没有需要展示的任务。")).toBeInTheDocument();
  expect(screen.getByText("今天没有额外提醒。")).toBeInTheDocument();
});
