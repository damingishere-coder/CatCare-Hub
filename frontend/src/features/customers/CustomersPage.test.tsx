import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { CustomersPage } from "./CustomersPage";
import type { CatDetail, CustomerDetail, CustomerSummary } from "./types";

const apiMocks = vi.hoisted(() => ({
  listCustomers: vi.fn(),
  getCustomer: vi.fn(),
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  createCat: vi.fn(),
  updateCat: vi.fn(),
}));

vi.mock("./api", () => apiMocks);

const timestamp = "2030-01-01T08:00:00";

const cat: CatDetail = {
  id: 11,
  customer_id: 1,
  name: "奶糖",
  photo_url: null,
  gender: "female",
  age: "2.5",
  breed: "测试品种",
  personality: "亲人",
  food: "测试主食",
  food_preference: "少量多餐",
  litter_type: "豆腐砂",
  medication_required: true,
  medication_notes: "晚间测试说明",
  special_notes: "无真实医疗信息",
  service_notes: "添粮、换水、清理猫砂",
  is_active: true,
  created_at: timestamp,
  updated_at: timestamp,
};

const summary: CustomerSummary = {
  id: 1,
  name: "测试客户（虚构）",
  wechat_name: "虚构微信",
  phone: "TEST-PHONE",
  community: "虚构小区",
  is_repeat_customer: true,
  active_cat_count: 1,
  inactive_cat_count: 0,
  updated_at: timestamp,
};

const detail: CustomerDetail = {
  id: 1,
  name: "测试客户（虚构）",
  wechat_name: "虚构微信",
  phone: "TEST-PHONE",
  community: "虚构小区",
  address: "不对应真实地点",
  building: "测试楼",
  unit: "测试单元",
  room: "测试房号",
  access_method: "虚构门禁",
  access_info: "虚构入户说明",
  key_status: "未提供",
  key_code: "TEST-KEY",
  notes: "自动测试资料",
  is_repeat_customer: true,
  cats: [cat],
  created_at: timestamp,
  updated_at: timestamp,
};

function prepareExistingCustomer() {
  apiMocks.listCustomers.mockResolvedValue({ items: [summary], total: 1 });
  apiMocks.getCustomer.mockResolvedValue(detail);
  apiMocks.updateCustomer.mockResolvedValue(detail);
  apiMocks.createCustomer.mockResolvedValue(detail);
  apiMocks.createCat.mockResolvedValue(cat);
  apiMocks.updateCat.mockResolvedValue(cat);
}

beforeEach(() => {
  vi.resetAllMocks();
  prepareExistingCustomer();
});

it("loads the customer list and keeps sensitive fields in the selected detail", async () => {
  render(<CustomersPage />);

  expect(await screen.findByRole("heading", { name: "测试客户（虚构）", level: 2 })).toBeInTheDocument();
  expect(screen.getByText("敏感信息，仅本地后台可见")).toBeInTheDocument();
  expect(screen.getByText("虚构入户说明")).toBeInTheDocument();
  expect(screen.getByText("未提供 · TEST-KEY")).toBeInTheDocument();

  const customerList = screen.getByLabelText("客户列表");
  expect(within(customerList).queryByText("虚构入户说明")).not.toBeInTheDocument();
  expect(within(customerList).queryByText("TEST-KEY")).not.toBeInTheDocument();
  expect(apiMocks.listCustomers).toHaveBeenCalledWith();
  expect(apiMocks.getCustomer).toHaveBeenCalledWith(1);
});

it("creates a complete customer from the admin form", async () => {
  apiMocks.listCustomers
    .mockResolvedValueOnce({ items: [], total: 0 })
    .mockResolvedValue({ items: [summary], total: 1 });
  apiMocks.createCustomer.mockResolvedValue(detail);
  apiMocks.getCustomer.mockResolvedValue(detail);

  render(<CustomersPage />);
  expect(await screen.findByText("还没有客户档案")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "新增客户" }));
  const dialog = screen.getByRole("dialog", { name: "新增客户" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: /姓名/ }), {
    target: { value: "测试客户（虚构）" },
  });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "手机号" }), {
    target: { value: "TEST-PHONE" },
  });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "小区" }), {
    target: { value: "虚构小区" },
  });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "门禁方式" }), {
    target: { value: "虚构门禁" },
  });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "入户信息" }), {
    target: { value: "虚构入户说明" },
  });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "钥匙编号" }), {
    target: { value: "TEST-KEY" },
  });
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "标记为老客户" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

  await waitFor(() => {
    expect(apiMocks.createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "测试客户（虚构）",
        phone: "TEST-PHONE",
        community: "虚构小区",
        access_method: "虚构门禁",
        access_info: "虚构入户说明",
        key_code: "TEST-KEY",
        is_repeat_customer: true,
      }),
    );
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("opens the create form from the dashboard quick-entry flag", async () => {
  render(<CustomersPage initialCreate />);

  expect(screen.getByRole("dialog", { name: "新增客户" })).toBeInTheDocument();
  await screen.findByRole("heading", { name: "测试客户（虚构）", level: 2 });
});

it("searches, adds a second cat, and soft-disables a cat", async () => {
  const secondCat: CatDetail = {
    ...cat,
    id: 12,
    name: "芝麻",
    medication_required: false,
    medication_notes: null,
    service_notes: "陪玩、拍照",
  };
  const detailWithTwoCats = { ...detail, cats: [cat, secondCat] };
  apiMocks.getCustomer
    .mockResolvedValueOnce(detail)
    .mockResolvedValueOnce(detailWithTwoCats)
    .mockResolvedValue(detailWithTwoCats);
  apiMocks.createCat.mockResolvedValue(secondCat);

  render(<CustomersPage />);
  expect(await screen.findByRole("heading", { name: "奶糖", level: 4 })).toBeInTheDocument();

  fireEvent.change(screen.getByRole("searchbox", { name: "搜索客户" }), {
    target: { value: "奶糖" },
  });
  fireEvent.click(screen.getByRole("button", { name: "搜索" }));
  await waitFor(() => expect(apiMocks.listCustomers).toHaveBeenLastCalledWith("奶糖"));

  fireEvent.click(screen.getByRole("button", { name: "添加猫咪" }));
  const dialog = screen.getByRole("dialog", { name: "添加猫咪" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: /名字/ }), {
    target: { value: "芝麻" },
  });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "服务注意事项" }), {
    target: { value: "陪玩、拍照" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

  await waitFor(() => expect(apiMocks.createCat).toHaveBeenCalledWith(1, expect.objectContaining({ name: "芝麻" })));
  expect(await screen.findByRole("heading", { name: "芝麻", level: 4 })).toBeInTheDocument();

  const stoppedCat = { ...cat, is_active: false };
  apiMocks.updateCat.mockResolvedValue(stoppedCat);
  apiMocks.getCustomer.mockResolvedValueOnce({ ...detailWithTwoCats, cats: [stoppedCat, secondCat] });
  vi.spyOn(window, "confirm").mockReturnValue(true);

  const firstCatCard = screen.getByRole("heading", { name: "奶糖", level: 4 }).closest("article");
  expect(firstCatCard).not.toBeNull();
  fireEvent.click(within(firstCatCard as HTMLElement).getByRole("button", { name: "停用" }));

  await waitFor(() => expect(apiMocks.updateCat).toHaveBeenCalledWith(1, 11, { is_active: false }));
  expect(await within(firstCatCard as HTMLElement).findByText("已停用")).toBeInTheDocument();
});

it("shows a clean empty state when a search has no matches", async () => {
  apiMocks.listCustomers
    .mockResolvedValueOnce({ items: [summary], total: 1 })
    .mockResolvedValueOnce({ items: [], total: 0 });
  render(<CustomersPage />);
  expect(await screen.findByRole("heading", { name: "测试客户（虚构）", level: 2 })).toBeInTheDocument();

  fireEvent.change(screen.getByRole("searchbox", { name: "搜索客户" }), {
    target: { value: "不存在的客户" },
  });
  fireEvent.click(screen.getByRole("button", { name: "搜索" }));

  expect(await screen.findByText("没有找到客户")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "测试客户（虚构）", level: 2 })).not.toBeInTheDocument();
  expect(screen.getByText("选择一位客户查看完整档案")).toBeInTheDocument();
});
