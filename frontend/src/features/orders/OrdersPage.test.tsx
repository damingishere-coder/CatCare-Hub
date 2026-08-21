import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { OrdersPage } from "./OrdersPage";
import type {
  OrderDetail,
  OrderFormOptions,
  OrderSummary,
  OrderTask,
} from "./types";

const apiMocks = vi.hoisted(() => ({
  listOrders: vi.fn(),
  getOrder: vi.fn(),
  getOrderFormOptions: vi.fn(),
  createOrder: vi.fn(),
  updateOrder: vi.fn(),
  updateOrderStatus: vi.fn(),
}));

vi.mock("./api", () => apiMocks);

const timestamp = "2030-09-01T08:00:00";
const tasks: OrderTask[] = Array.from({ length: 7 }, (_, index) => ({
  id: index + 1,
  service_date: `2030-10-${String(index + 1).padStart(2, "0")}`,
  planned_time: null,
  sort_order: 0,
  status: "pending",
  items: [
    { item_type: "feed", required: true, completed: false },
    { item_type: "water", required: true, completed: false },
  ],
}));

const summary: OrderSummary = {
  id: 1,
  customer: { id: 1, name: "订单页面客户（虚构）", community: "虚构小区" },
  cats: [
    { id: 1, name: "奶糖", is_active: true },
    { id: 2, name: "芝麻", is_active: true },
  ],
  start_date: "2030-10-01",
  end_date: "2030-10-07",
  visits_per_day: 1,
  service_days: 7,
  total_visits: 7,
  service_items: ["feed", "water"],
  base_price: "30.00",
  extra_cat_fee: "5.00",
  stairs_fee: "0.00",
  other_fee: "0.00",
  total_amount: "245.00",
  paid_amount: "0.00",
  due_amount: "245.00",
  payment_status: "unpaid",
  order_status: "pending_confirmation",
  task_count: 7,
  updated_at: timestamp,
};

const detail: OrderDetail = {
  ...summary,
  notes: "虚构订单页面测试",
  tasks,
  created_at: timestamp,
};

const options: OrderFormOptions = {
  customers: [
    {
      id: 1,
      name: "订单页面客户（虚构）",
      community: "虚构小区",
      cats: [
        { id: 1, name: "奶糖" },
        { id: 2, name: "芝麻" },
      ],
    },
  ],
  default_base_price: "30.00",
  extra_cat_unit_price: "5.00",
  stairs_unit_price: "5.00",
};

beforeEach(() => {
  vi.resetAllMocks();
  apiMocks.listOrders.mockResolvedValue({ items: [summary], total: 1 });
  apiMocks.getOrder.mockResolvedValue(detail);
  apiMocks.getOrderFormOptions.mockResolvedValue(options);
  apiMocks.createOrder.mockResolvedValue(detail);
  apiMocks.updateOrder.mockResolvedValue(detail);
  apiMocks.updateOrderStatus.mockResolvedValue(detail);
});

it("shows an order, authoritative pricing, and seven generated tasks", async () => {
  render(<OrdersPage />);

  expect(await screen.findByRole("heading", { name: "订单 #1", level: 2 })).toBeInTheDocument();
  expect(screen.getByText("7 天 × 1 次/天 = 7 次")).toBeInTheDocument();
  expect(screen.getAllByText("¥245.00").length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText("共 7 个任务；具体时间与排序请在“按天计划”中设置。")).toBeInTheDocument();
  expect(screen.getByText("2030-10-01")).toBeInTheDocument();
  expect(screen.getByText("2030-10-07")).toBeInTheDocument();
  expect(apiMocks.getOrder).toHaveBeenCalledWith(1);
});

it("creates a seven-day two-cat order without submitting a total amount", async () => {
  apiMocks.listOrders
    .mockResolvedValueOnce({ items: [], total: 0 })
    .mockResolvedValue({ items: [summary], total: 1 });
  render(<OrdersPage />);
  expect(await screen.findByText("还没有订单")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "新建订单" }));
  const dialog = screen.getByRole("dialog", { name: "新建订单" });
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "奶糖" }));
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "芝麻" }));
  fireEvent.change(within(dialog).getByLabelText("开始日期"), {
    target: { value: "2030-10-01" },
  });
  fireEvent.change(within(dialog).getByLabelText("结束日期"), {
    target: { value: "2030-10-07" },
  });

  expect(within(dialog).getByText("7 次")).toBeInTheDocument();
  expect(within(dialog).getByText("¥245.00")).toBeInTheDocument();
  fireEvent.click(
    within(dialog).getByRole("button", { name: "创建订单并生成任务" }),
  );

  await waitFor(() => expect(apiMocks.createOrder).toHaveBeenCalledTimes(1));
  const payload = apiMocks.createOrder.mock.calls[0]?.[0] as Record<string, unknown>;
  expect(payload).toEqual(
    expect.objectContaining({
      customer_id: 1,
      cat_ids: [1, 2],
      start_date: "2030-10-01",
      end_date: "2030-10-07",
      visits_per_day: 1,
      base_price: "30.00",
    }),
  );
  expect(payload).not.toHaveProperty("total_amount");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("edits an order and updates status through separate protected actions", async () => {
  render(<OrdersPage />);
  expect(await screen.findByRole("heading", { name: "订单 #1", level: 2 })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "编辑订单" }));
  const dialog = screen.getByRole("dialog", { name: "编辑订单 #1" });
  expect(within(dialog).getByText(/已有执行记录时系统会拒绝修改/)).toBeInTheDocument();
  fireEvent.change(within(dialog).getByRole("spinbutton", { name: "每日次数" }), {
    target: { value: "2" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存并同步任务" }));
  await waitFor(() =>
    expect(apiMocks.updateOrder).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ visits_per_day: 2 }),
    ),
  );

  const cancelled: OrderDetail = {
    ...detail,
    order_status: "cancelled",
    tasks: tasks.map((task) => ({ ...task, status: "cancelled" })),
  };
  apiMocks.updateOrderStatus.mockResolvedValue(cancelled);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  fireEvent.change(screen.getByRole("combobox", { name: "更新订单状态" }), {
    target: { value: "cancelled" },
  });

  await waitFor(() =>
    expect(apiMocks.updateOrderStatus).toHaveBeenCalledWith(1, "cancelled"),
  );
});
