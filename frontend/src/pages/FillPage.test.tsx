import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { emptyPublicCat, publicEditableDraft } from "../features/intake/constants";
import type { PublicIntakeDraftPayload, PublicIntakeRead } from "../features/intake/types";
import { FillPage } from "./FillPage";

const apiMocks = vi.hoisted(() => ({
  getPublicIntake: vi.fn(),
  savePublicDraft: vi.fn(),
  submitPublicIntake: vi.fn(),
}));

vi.mock("../features/intake/api", () => apiMocks);

const token = "P10-safe-test-token-value-abcdefghijklmnopqrstuvwxyz";
const completeDraft: PublicIntakeDraftPayload = {
  ...publicEditableDraft(null),
  customer: {
    ...publicEditableDraft(null).customer,
    name: "P10 页面虚构客户",
    wechat_name: "TEST-WECHAT",
    address: "不对应真实位置的页面测试地址",
  },
  cats: [{ ...emptyPublicCat(), name: "P10 页面测试猫" }],
  service: {
    start_date: "2031-05-01",
    end_date: "2031-05-02",
    visits_per_day: 1,
  },
};

const editableResponse: PublicIntakeRead = {
  status: "editable",
  expires_at: "2031-05-10T00:00:00Z",
  draft: completeDraft,
  revision: "a".repeat(64),
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
    revision: null,
  });
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});

it("loads an isolated draft and saves edited customer information", async () => {
  renderPage();

  const name = await screen.findByRole("textbox", { name: /客户姓名/ });
  expect(name).toHaveValue("P10 页面虚构客户");
  expect(screen.queryByRole("textbox", { name: /进门说明|钥匙编号|门禁密码/ })).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: /微信/ })).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: /手机号/ })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "猫咪 1" })).toBeInTheDocument();

  fireEvent.change(name, { target: { value: "已修改的虚构客户" } });
  fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));

  await waitFor(() => expect(apiMocks.savePublicDraft).toHaveBeenCalledWith(
    token,
    expect.objectContaining({
      customer: expect.objectContaining({ name: "已修改的虚构客户" }),
    }),
    "a".repeat(64),
  ));
  expect(await screen.findByText(/草稿已保存/)).toBeInTheDocument();
});

it("adds a cat and submits only after explicit confirmation action", async () => {
  renderPage();
  await screen.findByRole("textbox", { name: /客户姓名/ });

  fireEvent.click(screen.getByRole("button", { name: "添加猫咪" }));
  const secondCat = screen.getByRole("article", { name: "猫咪 2" });
  fireEvent.change(within(secondCat).getByRole("textbox", { name: /名字/ }), {
    target: { value: "第二只虚构测试猫" },
  });
  fireEvent.click(screen.getByRole("button", { name: "提交资料" }));

  await waitFor(() => expect(apiMocks.submitPublicIntake).toHaveBeenCalledWith(
    token,
    expect.objectContaining({ cats: expect.arrayContaining([expect.objectContaining({ name: "第二只虚构测试猫" })]) }),
    "a".repeat(64),
    expect.any(String),
  ));
  expect(await screen.findByRole("heading", { name: "资料已提交" })).toBeInTheDocument();
  expect(screen.getByText(/提交后不能修改/)).toBeInTheDocument();
});

it("shows a closed or expired link without rendering sensitive draft fields", async () => {
  apiMocks.getPublicIntake.mockRejectedValue(new Error("填写链接已过期"));
  renderPage();

  expect(await screen.findByRole("alert")).toHaveTextContent("填写链接已过期");
  expect(screen.queryByRole("textbox", { name: /客户姓名/ })).not.toBeInTheDocument();
});
