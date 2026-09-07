import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { emptyPublicCat, publicEditableDraft } from "../features/intake/constants";
import type { PublicIntakeDraftPayload, PublicIntakeRead } from "../features/intake/types";
import { FillPage } from "./FillPage";

const apiMocks = vi.hoisted(() => ({
  getPublicIntake: vi.fn(),
  submitPublicIntake: vi.fn(),
}));

vi.mock("../features/intake/api", () => apiMocks);

const token = "P24-safe-test-token-value-abcdefghijklmnopqrstuvwxyz";
const revision = "a".repeat(64);

const emptyResponse: PublicIntakeRead = {
  status: "editable",
  expires_at: "2031-05-10T00:00:00Z",
  draft: null,
  revision,
};

const legacyDraft: PublicIntakeDraftPayload = {
  ...publicEditableDraft(null),
  customer: {
    ...publicEditableDraft(null).customer,
    name: "P24 页面虚构客户",
    wechat_name: "TEST-WECHAT",
    address: "不对应真实位置的页面测试地址",
    access_method: "门卡",
    key_status: "待取",
    notes: "旧草稿中的客户备注",
  },
  cats: [{
    ...emptyPublicCat(),
    name: "P24 页面测试猫",
    food: "虚构饮食资料",
    litter_type: "旧草稿猫砂",
    medication_required: true,
    medication_notes: "旧草稿用药资料",
    special_notes: "虚构注意事项",
  }],
  service: {
    start_date: "2031-05-01",
    end_date: null,
    visits_per_day: 1,
  },
  notes: "客户填写的待审核备注",
};

function responseFor(draft: PublicIntakeDraftPayload | null): PublicIntakeRead {
  return { ...emptyResponse, draft };
}

function renderPage() {
  return render(<FillPage token={token} />);
}

beforeEach(() => {
  vi.resetAllMocks();
  apiMocks.getPublicIntake.mockResolvedValue(emptyResponse);
  apiMocks.submitPublicIntake.mockResolvedValue({
    status: "submitted",
    expires_at: emptyResponse.expires_at,
    draft: null,
    revision: null,
  });
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});

it("shows only the core form first and reveals simplified optional sections", async () => {
  renderPage();

  expect(await screen.findByRole("textbox", { name: /客户姓名/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /地址与交接/ })).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByRole("button", { name: /猫咪资料/ })).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("textbox", { name: "完整服务地址" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "保存草稿" })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /地址与交接/ }));
  expect(screen.getByRole("textbox", { name: "完整服务地址" })).toBeInTheDocument();
  const communityAccess = screen.getByRole("combobox", { name: "小区门禁" });
  const buildingAccess = screen.getByRole("combobox", { name: "楼下门禁" });
  expect(communityAccess).toHaveValue("");
  expect(buildingAccess).toHaveValue("");
  expect(within(communityAccess).getByRole("option", { name: "无" })).toBeInTheDocument();
  expect(within(buildingAccess).getByRole("option", { name: "无" })).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "钥匙状态" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /猫咪资料/ }));
  fireEvent.click(screen.getByRole("button", { name: "添加猫咪" }));
  const cat = screen.getByRole("article", { name: "猫咪 1" });
  expect(within(cat).getByRole("textbox", { name: "名字" })).toBeInTheDocument();
  expect(within(cat).queryByRole("textbox", { name: "饮食" })).not.toBeInTheDocument();
  expect(within(cat).queryByText("猫砂类型")).not.toBeInTheDocument();
  expect(within(cat).queryByText(/需要用药|用药说明/)).not.toBeInTheDocument();
});

it("requires a name and one contact method before opening confirmation", async () => {
  renderPage();

  const name = await screen.findByRole("textbox", { name: /客户姓名/ });
  fireEvent.change(name, { target: { value: "只有称呼的虚构客户" } });
  fireEvent.click(screen.getByRole("button", { name: "提交资料" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("手机号和微信至少填写一项");
  expect(screen.queryByRole("alertdialog", { name: "确认提交资料？" })).not.toBeInTheDocument();
  expect(apiMocks.submitPublicIntake).not.toHaveBeenCalled();
});

it("preserves an untouched legacy schedule and submits only after confirmation", async () => {
  apiMocks.getPublicIntake.mockResolvedValue(responseFor(legacyDraft));
  renderPage();

  await screen.findByDisplayValue("P24 页面虚构客户");
  expect(screen.getByRole("button", { name: /地址与交接/ })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("button", { name: /猫咪资料/ })).toHaveAttribute("aria-expanded", "true");
  expect(screen.queryByRole("button", { name: "每天 2 次" })).not.toBeInTheDocument();
  expect(document.querySelector('input[type="date"]')).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /选择预计上门日期/ })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "提交资料" }));
  const dialog = screen.getByRole("alertdialog", { name: "确认提交资料？" });
  expect(apiMocks.submitPublicIntake).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "确认提交" }));

  await waitFor(() => expect(apiMocks.submitPublicIntake).toHaveBeenCalledWith(
    token,
    expect.objectContaining({
      cats: [expect.objectContaining({
        food: "虚构饮食资料",
        litter_type: "旧草稿猫砂",
        medication_required: true,
        medication_notes: "旧草稿用药资料",
      })],
      service: expect.objectContaining({
        start_date: "2031-05-01",
        end_date: null,
        visits_per_day: 1,
      }),
      notes: "客户填写的待审核备注",
    }),
    revision,
    expect.any(String),
  ));
  expect(await screen.findByRole("heading", { name: "资料已提交" })).toBeInTheDocument();
  expect(screen.getAllByText(/微信或电话/).length).toBeGreaterThan(0);
});

it("replaces a legacy access value only after a classified access choice", async () => {
  apiMocks.getPublicIntake.mockResolvedValue(responseFor(legacyDraft));
  renderPage();

  expect(await screen.findByText(/旧草稿记录的门禁方式为“门卡”/)).toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox", { name: "小区门禁" }), {
    target: { value: "无" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "楼下门禁" }), {
    target: { value: "门卡" },
  });
  expect(screen.queryByText(/旧草稿记录的门禁方式/)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "提交资料" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "确认提交" }));

  await waitFor(() => expect(apiMocks.submitPublicIntake).toHaveBeenCalledWith(
    token,
    expect.objectContaining({
      customer: expect.objectContaining({
        access_method: null,
        community_access_method: "无",
        building_access_method: "门卡",
      }),
    }),
    revision,
    expect.any(String),
  ));
});

it("returns from confirmation without submitting", async () => {
  apiMocks.getPublicIntake.mockResolvedValue(responseFor(legacyDraft));
  renderPage();

  await screen.findByDisplayValue("P24 页面虚构客户");
  fireEvent.click(screen.getByRole("button", { name: "提交资料" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "返回检查" }));

  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(apiMocks.submitPublicIntake).not.toHaveBeenCalled();
  expect(screen.getByDisplayValue("P24 页面虚构客户")).toBeInTheDocument();
});

it("shows a closed or expired link without rendering sensitive draft fields", async () => {
  apiMocks.getPublicIntake.mockRejectedValue(new Error("填写链接已过期"));
  renderPage();

  expect(await screen.findByRole("alert")).toHaveTextContent("填写链接已过期");
  expect(screen.queryByRole("textbox", { name: /客户姓名/ })).not.toBeInTheDocument();
});


it("focuses and describes invalid contact fields while preserving the customer's draft", async () => {
  apiMocks.getPublicIntake.mockResolvedValue(emptyResponse);
  render(<FillPage token={token} />);
  const name = await screen.findByLabelText(/客户姓名/);
  fireEvent.click(screen.getByRole("button", { name: "提交资料" }));
  expect(name).toHaveAttribute("aria-invalid", "true");
  expect(name).toHaveFocus();
  fireEvent.change(name, { target: { value: "待核对客户" } });
  fireEvent.click(screen.getByRole("button", { name: "提交资料" }));
  expect(screen.getByLabelText("手机号", { selector: "input" })).toHaveFocus();
  expect(name).toHaveValue("待核对客户");
  expect(apiMocks.submitPublicIntake).not.toHaveBeenCalled();
});
