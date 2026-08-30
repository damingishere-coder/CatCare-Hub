import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { OrdersPage } from "./OrdersPage";
import type { PlanTaskSummary } from "../plans/types";
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
  retryOrderGeocode: vi.fn(),
  previewDemoData: vi.fn(),
  clearDemoData: vi.fn(),
}));
const planApiMocks = vi.hoisted(() => ({ getPlanDays: vi.fn(), getDayPlan: vi.fn() }));

vi.mock("./api", () => apiMocks);
vi.mock("../plans/api", () => planApiMocks);

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
  write_revision: "a".repeat(64),
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
  settlement_mode: "daily",
  amount_adjustment: { type: "none", amount: "0.00", reason: null, service_date: null },
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
  financial_revision: "f".repeat(64),
  has_payment_history: false,
  daily_receivables: Array.from({ length: 7 }, (_, index) => ({ service_date: `2030-10-${String(index + 1).padStart(2, "0")}`, expected_amount: "35.00", paid_amount: "0.00", due_amount: "35.00", overpaid_amount: "0.00", task_status: "pending" as const })),
  order_status: "pending_confirmation",
  route_geocode_status: "pending",
  pending_cat_profile_count: 0,
  customer_resolution: null,
  is_demo_data: false,
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

function renderPage(initialCreate = false, initialEntry = "/admin/orders?order_id=1&date=2030-10-01") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <OrdersPage initialCreate={initialCreate} />
    </MemoryRouter>,
  );
}

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
  planApiMocks.getPlanDays.mockResolvedValue({ items: [], total: 0 });
  planApiMocks.getDayPlan.mockResolvedValue({
    service_date: "2030-10-01",
    task_count: 1,
    order_count: 1,
    cat_count: 2,
    revision: "p".repeat(64),
    schedule_locked: false,
    tasks: [{
      id: 1,
      order_id: 1,
      service_date: "2030-10-01",
      planned_time: "09:30:00",
      sort_order: 0,
      status: "confirmed",
      customer: summary.customer,
      cat_count: 2,
      cats: summary.cats.map((cat) => ({ id: cat.id, name: cat.name })),
      items: tasks[0].items,
      has_execution_history: false,
    }],
  });
});

it("uses the month calendar as the primary view and opens details on demand", async () => {
  planApiMocks.getPlanDays.mockResolvedValue({
    items: [{
      service_date: "2030-10-01",
      task_count: 2,
      order_count: 1,
      cat_count: 2,
      customer_names: [summary.customer.name],
      orders: [{ order_id: 1, customer_name: summary.customer.name, visit_count: 2, order_status: "confirmed" }],
    }],
    total: 1,
  });
  renderPage(false, "/admin/orders?date=2030-10-01");

  expect(await screen.findByRole("heading", { name: "订单月历" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "订单 #1", level: 2 })).not.toBeInTheDocument();
  const marker = await screen.findByRole("button", { name: /#1 ×2/ });
  fireEvent.click(marker);
  expect(await screen.findByRole("heading", { name: "订单 #1", level: 2 })).toBeInTheDocument();
  expect(apiMocks.getOrder).toHaveBeenCalledWith(1);
  expect(screen.queryByRole("heading", { name: "订单月历" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("2030-10-01 当天上门")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "路线地图" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "保存排程" })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "关闭订单详情" }));
  expect(screen.queryByRole("heading", { name: "订单 #1", level: 2 })).not.toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: "订单月历" })).toBeInTheDocument();
  expect(screen.getByLabelText("2030-10-01 当天上门")).toBeInTheDocument();
  const collapse = screen.getByRole("button", { name: "收起订单列表" });
  fireEvent.click(collapse);
  expect(screen.getByLabelText("订单列表")).toHaveClass("hidden");
  expect(screen.getByRole("button", { name: "展开订单列表" })).toBeInTheDocument();
});

it("shows every active visit in the exact route-saved order", async () => {
  const dayTask = (
    id: number,
    orderId: number,
    customerName: string,
    sortOrder: number,
    status: PlanTaskSummary["status"] = "confirmed",
  ): PlanTaskSummary => ({
    id,
    order_id: orderId,
    service_date: "2030-10-01",
    planned_time: sortOrder === 0 ? "08:30:00" : null,
    sort_order: sortOrder,
    status,
    customer: { id: orderId, name: customerName, community: "虚构小区", address: `${customerName}地址` },
    cat_count: 1,
    cats: [{ id, name: `猫咪${id}` }],
    items: [{ item_type: "feed", required: true, completed: false }],
    has_execution_history: false,
  });
  planApiMocks.getDayPlan.mockResolvedValue({
    service_date: "2030-10-01",
    task_count: 4,
    order_count: 3,
    cat_count: 4,
    revision: "r".repeat(64),
    schedule_locked: false,
    tasks: [
      dayTask(8, 2, "路线第一位客户", 0),
      dayTask(3, 1, "同单第一次上门", 1),
      dayTask(4, 1, "同单第二次上门", 2),
      dayTask(9, 3, "已取消客户", 3, "cancelled"),
    ],
  });
  renderPage(false, "/admin/orders?date=2030-10-01");

  const visitList = await screen.findByLabelText("2030-10-01 当天上门");
  const visitButtons = within(visitList).getAllByRole("button", { name: /路线第/ });
  expect(visitButtons.map((button) => button.getAttribute("aria-label"))).toEqual([
    "路线第 1 站，路线第一位客户，订单 #2",
    "路线第 2 站，同单第一次上门，订单 #1",
    "路线第 3 站，同单第二次上门，订单 #1",
  ]);
  expect(within(visitList).queryByText("已取消客户")).not.toBeInTheDocument();
  expect(within(visitList).getByRole("link", { name: "去路线图调整顺序" })).toHaveAttribute("href", "/admin/routes?date=2030-10-01");
});

it("shows an order, authoritative pricing, and seven generated tasks", async () => {
  renderPage();

  expect(
    await screen.findByRole(
      "heading",
      { name: "订单 #1", level: 2 },
      { timeout: 5000 },
    ),
  ).toBeInTheDocument();
  expect(screen.getByText("7 个日期 · 7 次")).toBeInTheDocument();
  expect(screen.getAllByText("¥245.00").length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText("共 7 个任务；具体时间与顺序由“路线图”维护。")).toBeInTheDocument();
  expect(screen.getAllByText("2030-10-01").length).toBeGreaterThanOrEqual(1);
  expect(screen.getAllByText("2030-10-07").length).toBeGreaterThanOrEqual(1);
  expect(apiMocks.getOrder).toHaveBeenCalledWith(1);
});

it("creates a daily order with standard access selects and a dated surcharge", async () => {
  apiMocks.listOrders
    .mockResolvedValueOnce({ items: [], total: 0 })
    .mockResolvedValue({ items: [summary], total: 1 });
  renderPage();
  expect(await screen.findByText("还没有订单")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "新建订单" }));
  const dialog = screen.getByRole("dialog", { name: "新建订单" });
  fireEvent.change(within(dialog).getByLabelText(/^联系人名称/), { target: { value: "直接输入的订单联系人" } });
  fireEvent.change(within(dialog).getByLabelText("详细地址"), { target: { value: "虚构订单地址 8 号" } });
  expect(within(dialog).getByLabelText("入户方式").tagName).toBe("SELECT");
  expect(within(dialog).getByLabelText("钥匙状态").tagName).toBe("SELECT");
  fireEvent.change(within(dialog).getByLabelText("入户方式"), { target: { value: "钥匙" } });
  fireEvent.change(within(dialog).getByLabelText("钥匙状态"), { target: { value: "已取" } });
  fireEvent.change(within(dialog).getByLabelText("钥匙编号"), { target: { value: "TEST-KEY-18" } });
  fireEvent.change(within(dialog).getByLabelText("猫咪数量"), { target: { value: "2" } });
  const today = new Date();
  fireEvent.click(within(dialog).getByRole("button", { name: String(today.getDate()) }));

  expect(within(dialog).getByLabelText("结算方式")).toHaveValue("daily");
  fireEvent.change(within(dialog).getByLabelText("金额变动"), { target: { value: "surcharge" } });
  fireEvent.change(within(dialog).getByLabelText("变动金额（元）"), { target: { value: "5" } });
  fireEvent.change(within(dialog).getByLabelText("原因"), { target: { value: "节假日加收" } });
  fireEvent.change(within(dialog).getByLabelText("每次价格（元）"), { target: { value: "31.2" } });
  expect(within(dialog).getAllByText("¥36.20").length).toBeGreaterThanOrEqual(2);
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
      unit_price: "31.20",
      settlement_mode: "daily",
      amount_adjustment: expect.objectContaining({
        type: "surcharge",
        amount: "5.00",
        reason: "节假日加收",
        service_date: expect.any(String),
      }),
    }),
  );
  expect(payload).not.toHaveProperty("customer_id");
  expect(payload).not.toHaveProperty("source_customer_id");
  expect(payload).not.toHaveProperty("total_amount");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("parses a pasted residential address locally and uses five editable fields", async () => {
  apiMocks.listOrders.mockResolvedValue({ items: [], total: 0 });
  renderPage();
  expect(await screen.findByText("还没有订单")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "新建订单" }));
  const dialog = screen.getByRole("dialog", { name: "新建订单" });
  const smartPaste = within(dialog).getByLabelText("粘贴地址智能填写");
  fireEvent.paste(smartPaste, {
    clipboardData: {
      getData: () => "广东省深圳市龙华区民治街道 星河盛世花园 3栋 2单元 1201室",
    },
  });

  expect(within(dialog).getByLabelText("小区")).toHaveValue("星河盛世花园");
  expect(within(dialog).getByLabelText("详细地址")).toHaveValue("广东省深圳市龙华区民治街道");
  expect(within(dialog).getByLabelText("楼栋")).toHaveValue("3栋");
  expect(within(dialog).getByLabelText("单元 / 房间")).toHaveValue("2单元 / 1201室");
  expect(within(dialog).getByText("已自动拆分地址，请核对后再保存。")).toBeInTheDocument();
  fireEvent.paste(smartPaste, {
    clipboardData: {
      getData: () => "广东省深圳市龙华区民治街道 星河盛世花园 3栋 2单元 1201室",
    },
  });
  fireEvent.change(within(dialog).getByLabelText("单元 / 房间"), {
    target: { value: "7单元 / 701室" },
  });
  expect(within(dialog).getByLabelText("单元 / 房间")).toHaveValue("7单元 / 701室");
  expect(apiMocks.createOrder).not.toHaveBeenCalled();
});

it("adds the default Shenzhen Longgang prefix to a local pasted address", async () => {
  apiMocks.listOrders.mockResolvedValue({ items: [], total: 0 });
  renderPage();
  expect(await screen.findByText("还没有订单")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "新建订单" }));
  const dialog = screen.getByRole("dialog", { name: "新建订单" });
  const smartPaste = within(dialog).getByLabelText("粘贴地址智能填写");

  fireEvent.paste(smartPaste, {
    clipboardData: { getData: () => "长坑三巷21号1312房" },
  });

  expect(within(dialog).getByLabelText("详细地址"))
    .toHaveValue("深圳市龙岗区长坑三巷21号");
  expect(within(dialog).getByLabelText("单元 / 房间")).toHaveValue("1312房");
});

it("steps the unit price by five while preserving decimals and allowing manual input", async () => {
  apiMocks.listOrders.mockResolvedValue({ items: [], total: 0 });
  renderPage();
  expect(await screen.findByText("还没有订单")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "新建订单" }));
  const dialog = screen.getByRole("dialog", { name: "新建订单" });
  const price = within(dialog).getByLabelText("每次价格（元）");
  fireEvent.change(price, { target: { value: "30.03" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "每次价格增加 5 元" }));
  expect(price).toHaveValue("35.03");
  fireEvent.keyDown(price, { key: "ArrowDown" });
  expect(price).toHaveValue("30.03");
  fireEvent.keyDown(price, { key: "ArrowUp" });
  expect(price).toHaveValue("35.03");
  fireEvent.click(within(dialog).getByRole("button", { name: "每次价格减少 5 元" }));
  expect(price).toHaveValue("30.03");
  fireEvent.change(price, { target: { value: "3.03" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "每次价格减少 5 元" }));
  expect(price).toHaveValue("0.00");
  fireEvent.change(price, { target: { value: "31.27" } });
  expect(price).toHaveValue("31.27");
});

it("rejects an invalid manually entered unit price", async () => {
  apiMocks.listOrders.mockResolvedValue({ items: [], total: 0 });
  renderPage();
  expect(await screen.findByText("还没有订单")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "新建订单" }));
  const dialog = screen.getByRole("dialog", { name: "新建订单" });
  fireEvent.change(within(dialog).getByLabelText(/^联系人名称/), { target: { value: "价格校验客户" } });
  const today = new Date();
  fireEvent.click(within(dialog).getByRole("button", { name: String(today.getDate()) }));
  fireEvent.change(within(dialog).getByLabelText("每次价格（元）"), { target: { value: "不是金额" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "创建订单" }));
  expect(within(dialog).getByRole("alert")).toHaveTextContent("每次价格必须是大于或等于 0 的数字");
  expect(apiMocks.createOrder).not.toHaveBeenCalled();
});

it("opens the create form from the dashboard quick-entry flag", async () => {
  renderPage(true);

  await waitFor(() =>
    expect(screen.getByRole("dialog", { name: "新建订单" })).toBeInTheDocument(),
  );
});

it("edits an order and keeps cancellation as a separate protected action", async () => {
  renderPage();
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
      "a".repeat(64),
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
    expect(apiMocks.updateOrderStatus).toHaveBeenCalledWith(
      1,
      "cancelled",
      "a".repeat(64),
    ),
  );
});

it("allows a payment-history order to change only unit price with its revision", async () => {
  const paidDetail: OrderDetail = {
    ...detail,
    unit_price: "30.03",
    paid_amount: "30.00",
    due_amount: "180.21",
    payment_status: "partial",
    has_payment_history: true,
    financial_revision: "c".repeat(64),
  };
  apiMocks.listOrders.mockResolvedValue({ items: [paidDetail], total: 1 });
  apiMocks.getOrder.mockResolvedValue(paidDetail);
  apiMocks.updateOrder.mockResolvedValue(paidDetail);
  renderPage();
  expect(await screen.findByRole("heading", { name: "订单 #1", level: 2 })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "编辑订单" }));
  const dialog = screen.getByRole("dialog", { name: "编辑订单 #1" });
  const price = within(dialog).getByLabelText("每次价格（元）");
  expect(price).toBeEnabled();
  expect(within(dialog).getByLabelText("猫咪数量")).toBeDisabled();
  expect(within(dialog).getByLabelText("结算方式")).toBeDisabled();
  fireEvent.click(within(dialog).getByRole("button", { name: "每次价格增加 5 元" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "保存订单" }));

  await waitFor(() => expect(apiMocks.updateOrder).toHaveBeenCalledWith(
    1,
    {
      unit_price: "35.03",
      expected_financial_revision: "c".repeat(64),
    },
    "a".repeat(64),
  ));
});
