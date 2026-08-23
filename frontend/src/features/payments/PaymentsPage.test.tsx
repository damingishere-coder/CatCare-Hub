import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { PaymentsPage } from "./PaymentsPage";
import type { PaymentsOverview } from "./types";

const apiMocks = vi.hoisted(() => ({
  getPaymentsOverview: vi.fn(),
  registerPayment: vi.fn(),
}));

vi.mock("./api", () => apiMocks);

const overview: PaymentsOverview = {
  business_date: "2035-10-06",
  month_start: "2035-10-01",
  metrics: {
    today_income: "88.50",
    pending_order_count: 1,
    month_income: "4860.00",
    completed_order_count: 7,
  },
  receivables: [
    {
      order_id: 12,
      customer_name: "P8 页面客户（虚构）",
      community: "P8 虚构小区",
      address: "P8 不对应真实地点的地址",
      start_date: "2035-10-06",
      end_date: "2035-10-08",
      cat_count: 2,
      total_amount: "90.00",
      paid_amount: "30.00",
      due_amount: "60.00",
      overpaid_amount: "0.00",
      payment_status: "partial",
      order_status: "completed",
      revision: "a".repeat(64),
    },
  ],
  records: [
    {
      id: 31,
      order_id: 12,
      customer_name: "P8 页面客户（虚构）",
      start_date: "2035-10-06",
      end_date: "2035-10-08",
      cat_count: 2,
      amount: "30.00",
      payment_method: "alipay",
      payment_status: "completed",
      paid_at: "2035-10-06T01:00:00Z",
    },
  ],
};

function renderPage(props: { initialCreate?: boolean; initialOrderId?: number | null } = {}) {
  return render(
    <MemoryRouter>
      <PaymentsPage {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  apiMocks.getPaymentsOverview.mockResolvedValue(overview);
  apiMocks.registerPayment.mockResolvedValue({ payment: overview.records[0], order: overview.receivables[0] });
});

it("shows real summaries, receivables, and immutable payment records", async () => {
  renderPage();

  expect(await screen.findByRole("heading", { name: "收款记录" })).toBeInTheDocument();
  const todayCard = (await screen.findByText("今日收款", {}, { timeout: 5000 })).closest("article");
  const monthCard = screen.getByText("本月收入").closest("article");
  expect(todayCard).not.toBeNull();
  expect(monthCard).not.toBeNull();
  expect(within(todayCard as HTMLElement).getByText("¥88.50")).toBeInTheDocument();
  expect(within(monthCard as HTMLElement).getByText("¥4,860.00")).toBeInTheDocument();
  expect(screen.getAllByText("P8 页面客户（虚构）")).toHaveLength(2);
  expect(screen.getByText("支付宝")).toBeInTheDocument();
  expect(screen.getByText("已完成")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "登记收款" })).toBeEnabled();
});

it("opens a targeted order, registers a payment, and refreshes", async () => {
  apiMocks.getPaymentsOverview
    .mockResolvedValueOnce(overview)
    .mockResolvedValueOnce({
      ...overview,
      metrics: { ...overview.metrics, today_income: "98.50" },
      receivables: [],
      records: [
        { ...overview.records[0], id: 32, amount: "10.00", payment_method: "cash" },
        ...overview.records,
      ],
    });
  renderPage({ initialCreate: true, initialOrderId: 12 });

  expect(await screen.findByRole("dialog", { name: "登记收款" })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("本次金额（元）"), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText("收款方式"), { target: { value: "cash" } });
  fireEvent.change(screen.getByLabelText("收款时间（Asia/Shanghai）"), { target: { value: "2035-10-06T09:30" } });
  fireEvent.change(screen.getByLabelText(/备注/), { target: { value: "  P8 虚构备注  " } });
  fireEvent.click(screen.getByRole("button", { name: "确认登记" }));

  await waitFor(() => expect(apiMocks.registerPayment).toHaveBeenCalledWith({
    order_id: 12,
    amount: "10.00",
    payment_method: "cash",
    paid_at: "2035-10-06T09:30:00+08:00",
    notes: "P8 虚构备注",
    expected_revision: "a".repeat(64),
  }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "登记收款" })).not.toBeInTheDocument());
  expect(apiMocks.getPaymentsOverview).toHaveBeenCalledTimes(2);
});

it("recovers from an API error and shows clean empty states", async () => {
  apiMocks.getPaymentsOverview.mockRejectedValueOnce(new Error("P8 虚构加载失败"));
  renderPage();

  expect(await screen.findByRole("alert")).toHaveTextContent("P8 虚构加载失败");
  apiMocks.getPaymentsOverview.mockResolvedValueOnce({
    ...overview,
    metrics: {
      today_income: "0.00",
      pending_order_count: 0,
      month_income: "0.00",
      completed_order_count: 0,
    },
    receivables: [],
    records: [],
  });
  fireEvent.click(screen.getByRole("button", { name: "刷新" }));

  expect(await screen.findByText("当前没有待收订单。")).toBeInTheDocument();
  expect(screen.getByText("还没有收款流水。")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "登记收款" })).toBeDisabled();
});
