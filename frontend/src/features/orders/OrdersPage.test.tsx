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
  deleteOrder: vi.fn(),
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

const serviceContact = {
  name: "订单页面客户（虚构）",
  wechat_name: null,
  phone: "TEST-PHONE",
  community: "虚构小区",
  address: "虚构小区 1 号楼",
  building: null,
  unit: null,
  room: null,
  access_method: null,
  access_info: null,
  key_status: null,
  key_code: null,
  notes: null,
  is_repeat_customer: false,
  latitude: null,
  longitude: null,
  geocode_status: null,
};

const catDefaults = {
  photo_url: null,
  gender: null,
  age: null,
  breed: null,
  personality: null,
  food: null,
  food_preference: null,
  litter_type: null,
  medication_required: false,
  medication_notes: null,
  special_notes: null,
  service_notes: null,
};

const summary: OrderSummary = {
  id: 1,
  source_customer_id: 1,
  service_contact: serviceContact,
  cat_snapshot: [
    { ...catDefaults, source_cat_id: 1, name: "奶糖" },
    { ...catDefaults, source_cat_id: 2, name: "芝麻" },
  ],
  customer: { id: 1, name: "订单页面客户（虚构）", community: "虚构小区", address: "虚构小区 1 号楼" },
  cats: [
    { id: 1, name: "奶糖", is_active: true },
    { id: 2, name: "芝麻", is_active: true },
  ],
  start_date: "2030-10-01",
  end_date: "2030-10-07",
  visits_per_day: 1,
  service_days: 7,
  total_visits: 7,
  cat_count: 2,
  service_schedule: Array.from({ length: 7 }, (_, index) => ({ service_date: `2030-10-${String(index + 1).padStart(2, "0")}`, visit_count: 1 })),
  service_items: ["feed", "water"],
  pricing_mode: "legacy_components",
  unit_price: "35.00",
  base_price: "30.00",
  extra_cat_fee: "5.00",
  stairs_fee: "0.00",
  other_fee: "0.00",
  total_amount: "245.00",
  paid_amount: "0.00",
  due_amount: "245.00",
  overpaid_amount: "0.00",
  payment_status: "unpaid",
  order_status: "pending_confirmation",
  task_count: 7,
  deletable: true,
  delete_block_reason: null,
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
      wechat_name: null,
      phone: "TEST-PHONE",
      community: "虚构小区",
      address: "虚构小区 1 号楼",
      building: null,
      unit: null,
      room: null,
      access_method: null,
      access_info: null,
      key_status: null,
      key_code: null,
      notes: null,
      is_repeat_customer: false,
      latitude: null,
      longitude: null,
      geocode_status: null,
      cats: [
        { ...catDefaults, id: 1, name: "奶糖" },
        { ...catDefaults, id: 2, name: "芝麻" },
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
  apiMocks.deleteOrder.mockResolvedValue(undefined);
});

it("shows an order, authoritative pricing, and seven generated tasks", async () => {
  render(<OrdersPage />);

  expect(
    await screen.findByRole(
      "heading",
      { name: "订单 #1", level: 2 },
      { timeout: 5000 },
    ),
  ).toBeInTheDocument();
  expect(screen.getByText("7 个日期 · 7 次")).toBeInTheDocument();
  expect(screen.getAllByText("¥245.00").length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText("共 7 个任务；具体时间与排序请在“按天计划”中设置。")).toBeInTheDocument();
  expect(screen.getByText("2030-10-01")).toBeInTheDocument();
  expect(screen.getByText("2030-10-07")).toBeInTheDocument();
  expect(apiMocks.getOrder).toHaveBeenCalledWith(1);
});

it("creates an order from plain contact text without creating or selecting a profile", async () => {
  apiMocks.listOrders
    .mockResolvedValueOnce({ items: [], total: 0 })
    .mockResolvedValue({ items: [summary], total: 1 });
  render(<OrdersPage />);
  expect(await screen.findByText("还没有订单")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "新建订单" }));
  const dialog = screen.getByRole("dialog", { name: "新建订单" });
  fireEvent.change(within(dialog).getByLabelText(/^联系人名称/), { target: { value: "直接输入的订单联系人" } });
  fireEvent.change(within(dialog).getByLabelText("详细地址"), { target: { value: "虚构订单地址 8 号" } });
  fireEvent.change(within(dialog).getByLabelText("猫咪数量"), { target: { value: "2" } });
  const today = new Date();
  fireEvent.click(within(dialog).getByRole("button", { name: String(today.getDate()) }));

  expect(within(dialog).getAllByText("¥30.00")).toHaveLength(2);
  fireEvent.click(within(dialog).getByRole("button", { name: "创建订单" }));

  await waitFor(() => expect(apiMocks.createOrder).toHaveBeenCalledTimes(1));
  const payload = apiMocks.createOrder.mock.calls[0]?.[0] as Record<string, unknown>;
  expect(payload).toEqual(
    expect.objectContaining({
      service_contact: expect.objectContaining({
        name: "直接输入的订单联系人",
        address: "虚构订单地址 8 号",
      }),
      cat_count: 2,
      service_dates: [expect.any(String)],
      unit_price: "30.00",
    }),
  );
  expect(payload).not.toHaveProperty("customer_id");
  expect(payload).not.toHaveProperty("source_customer_id");
  expect(payload).not.toHaveProperty("total_amount");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("opens the create form from the dashboard quick-entry flag", async () => {
  render(<OrdersPage initialCreate />);

  await waitFor(() =>
    expect(screen.getByRole("dialog", { name: "新建订单" })).toBeInTheDocument(),
  );
});

it("edits an order and keeps cancellation as a separate protected action", async () => {
  render(<OrdersPage />);
  expect(await screen.findByRole("heading", { name: "订单 #1", level: 2 })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "编辑订单" }));
  const dialog = screen.getByRole("dialog", { name: "编辑订单 #1" });
  fireEvent.change(within(dialog).getByRole("spinbutton", { name: "猫咪数量" }), {
    target: { value: "3" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存订单" }));
  await waitFor(() =>
    expect(apiMocks.updateOrder).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ cat_count: 3 }),
    ),
  );

  const cancelled: OrderDetail = {
    ...detail,
    order_status: "cancelled",
    tasks: tasks.map((task) => ({ ...task, status: "cancelled" })),
  };
  apiMocks.updateOrderStatus.mockResolvedValue(cancelled);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "取消订单" }));

  await waitFor(() =>
    expect(apiMocks.updateOrderStatus).toHaveBeenCalledWith(1, "cancelled"),
  );
});
