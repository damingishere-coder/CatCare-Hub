import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { editableDraft } from "../features/intake/constants";
import type { IntakeDraftPayload, PublicIntakeRead } from "../features/intake/types";
import { FillPage } from "./FillPage";

const apiMocks = vi.hoisted(() => ({
  getPublicIntake: vi.fn(),
  savePublicDraft: vi.fn(),
  submitPublicIntake: vi.fn(),
}));

vi.mock("../features/intake/api", () => apiMocks);

const token = "P10-safe-test-token-value-abcdefghijklmnopqrstuvwxyz";
const completeDraft: IntakeDraftPayload = {
  ...editableDraft(null),
  customer: {
    ...editableDraft(null).customer,
    name: "P10 页面虚构客户",
    wechat_name: "TEST-WECHAT",
    community: "P10 页面虚构小区",
    address: "不对应真实位置的页面测试地址",
    access_info: "虚构门禁说明",
    key_code: "TEST-KEY",
  },
  cats: [{ ...editableDraft(null).cats[0], name: "P10 页面测试猫" }],
  service: {
    start_date: "2031-05-01",
    end_date: "2031-05-02",
    visits_per_day: 1,
    service_items: ["feed", "water", "litter", "photo"],
  },
};

const editableResponse: PublicIntakeRead = {
  status: "editable",
  expires_at: "2031-05-10T00:00:00Z",
  draft: completeDraft,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/fill/${token}`]}>
      <Routes><Route path="/fill/:token" element={<FillPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  apiMocks.getPublicIntake.mockResolvedValue(editableResponse);
  apiMocks.savePublicDraft.mockResolvedValue(editableResponse);
  apiMocks.submitPublicIntake.mockResolvedValue({
    status: "submitted",
    expires_at: editableResponse.expires_at,
    draft: null,
  });
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});

it("loads an isolated draft and saves edited customer information", async () => {
  renderPage();

  const name = await screen.findByRole("textbox", { name: /^名称/ });
  expect(name).toHaveValue("P10 页面虚构客户");
  expect(screen.queryByRole("textbox", { name: /入户/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: /微信|手机号|小区|楼栋|单元|房号/ })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "猫咪 1" })).toBeInTheDocument();

  fireEvent.change(name, { target: { value: "已修改的虚构客户" } });
  fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));

  await waitFor(() => expect(apiMocks.savePublicDraft).toHaveBeenCalledWith(
    token,
    expect.objectContaining({
      customer: expect.objectContaining({ name: "已修改的虚构客户" }),
    }),
  ));
  expect(await screen.findByText(/草稿已保存/)).toBeInTheDocument();
});

it("adds a cat and submits only after explicit confirmation action", async () => {
  renderPage();
  await screen.findByRole("textbox", { name: /^名称/ });

  fireEvent.click(screen.getByRole("button", { name: "添加猫咪" }));
  const secondCat = screen.getByRole("article", { name: "猫咪 2" });
  fireEvent.change(within(secondCat).getByRole("textbox", { name: /名字/ }), {
    target: { value: "第二只虚构测试猫" },
  });
  fireEvent.click(screen.getByRole("button", { name: "提交资料" }));

  await waitFor(() => expect(apiMocks.submitPublicIntake).toHaveBeenCalledWith(
    token,
    expect.objectContaining({ cats: expect.arrayContaining([expect.objectContaining({ name: "第二只虚构测试猫" })]) }),
  ));
  expect(await screen.findByRole("heading", { name: "资料已收到" })).toBeInTheDocument();
  expect(screen.getByText(/资料已提交成功，后台确认后才会建立正式订单/)).toBeInTheDocument();
});

it("shows a closed or expired link without rendering sensitive draft fields", async () => {
  apiMocks.getPublicIntake.mockRejectedValue(new Error("填写链接已过期"));
  renderPage();

  expect(await screen.findByRole("alert")).toHaveTextContent("填写链接已过期");
  expect(screen.queryByRole("textbox", { name: /^名称/ })).not.toBeInTheDocument();
});
