import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { editableDraft } from "./constants";
import type { IntakeSubmissionDetail, IntakeSubmissionSummary, IntakeTokenRead } from "./types";
import { AdminIntakePage } from "./AdminIntakePage";

const apiMocks = vi.hoisted(() => ({
  listIntakeTokens: vi.fn(),
  createIntakeToken: vi.fn(),
  updateIntakeToken: vi.fn(),
  listIntakeSubmissions: vi.fn(),
  getIntakeSubmission: vi.fn(),
  saveIntakeReviewDraft: vi.fn(),
  decideIntakeSubmission: vi.fn(),
  updateIntakeSubmissionListState: vi.fn(),
}));

vi.mock("./api", () => apiMocks);

const timestamp = "2031-05-01T08:00:00Z";
const revision = "a".repeat(64);
const token: IntakeTokenRead = {
  id: 7,
  status: "active",
  expires_at: "2031-05-15T08:00:00Z",
  submitted_at: timestamp,
  fill_path: null,
  submission_status: "submitted",
  revision,
  created_at: timestamp,
};
const summary: IntakeSubmissionSummary = {
  id: 9,
  submission_uuid: "00000000-0000-4000-8000-000000000009",
  status: "submitted",
  customer_name: "P10 后台虚构客户",
  community: "P10 后台虚构小区",
  cat_count: 1,
  start_date: "2031-05-20",
  end_date: "2031-05-21",
  submitted_at: timestamp,
  updated_at: timestamp,
  revision,
};
const payload = {
  ...editableDraft(null),
  notes: "虚构待审核备注内容",
  customer: {
    ...editableDraft(null).customer,
    name: summary.customer_name,
    phone: "TEST-CONTACT",
    community: summary.community,
    address: "虚构后台测试地址",
    access_info: "虚构敏感入户说明",
    key_code: "TEST-KEY",
  },
  cats: [{ ...editableDraft(null).cats[0], name: "后台测试猫" }],
  service: {
    start_date: summary.start_date,
    end_date: summary.end_date,
    visits_per_day: 1,
    service_items: ["feed" as const, "photo" as const],
  },
};
const detail: IntakeSubmissionDetail = {
  ...summary,
  payload,
  review_payload: null,
  review_unit_price: null,
  reviewed_at: null,
  converted_at: null,
  voided_at: null,
  purge_after: null,
  redacted_at: null,
  decision_mode: null,
  decision_idempotency_key: null,
  converted_customer_id: null,
  converted_order_id: null,
  audit_events: [{
    id: 1,
    event_type: "submitted",
    actor: "customer",
    revision_number: 1,
    decision_mode: null,
    details: {},
    created_at: "2026-08-26T08:00:00Z",
  }],
};

function renderPage() {
  return render(<MemoryRouter><AdminIntakePage /></MemoryRouter>);
}

beforeEach(() => {
  vi.resetAllMocks();
  apiMocks.listIntakeTokens.mockResolvedValue({ items: [token], total: 1 });
  apiMocks.listIntakeSubmissions.mockResolvedValue({ items: [summary], total: 1 });
  apiMocks.getIntakeSubmission.mockResolvedValue(detail);
  apiMocks.createIntakeToken.mockResolvedValue({ ...token, id: 8, fill_path: "/f/P10-test-token", submitted_at: null, submission_status: null });
  apiMocks.updateIntakeToken.mockResolvedValue({ ...token, status: "disabled", submitted_at: null, submission_status: null });
  apiMocks.saveIntakeReviewDraft.mockResolvedValue({ ...detail, status: "reviewed", review_payload: payload, review_unit_price: "30.00", reviewed_at: timestamp, revision: "b".repeat(64) });
  apiMocks.decideIntakeSubmission.mockResolvedValue({ submission_id: 9, submission_uuid: summary.submission_uuid, status: "archived_order", decision_mode: "order", customer_id: 3, order_id: 4, revision: "c".repeat(64) });
  apiMocks.updateIntakeSubmissionListState.mockResolvedValue(detail);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

it("shows only the newest three links until expanded", async () => {
  const links = Array.from({ length: 5 }, (_, index) => ({
    ...token,
    id: 20 - index,
    created_at: `2031-05-0${5 - index}T08:00:00Z`,
  }));
  apiMocks.listIntakeTokens.mockResolvedValue({ items: links, total: links.length });
  renderPage();

  expect(await screen.findByText("链接 #20")).toBeInTheDocument();
  expect(screen.getByText("链接 #18")).toBeInTheDocument();
  expect(screen.queryByText("链接 #17")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "展开全部（5）" }));
  expect(screen.getByText("链接 #16")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "收起" }));
  expect(screen.queryByText("链接 #17")).not.toBeInTheDocument();
});

it("moves a voided record out of the current list and can restore it", async () => {
  const voidedSummary: IntakeSubmissionSummary = {
    ...summary,
    status: "voided",
    removed_at: null,
  };
  const voidedDetail: IntakeSubmissionDetail = {
    ...detail,
    ...voidedSummary,
    status: "voided",
    voided_at: timestamp,
    decision_mode: "void",
  };
  const removedDetail = { ...voidedDetail, removed_at: "2031-05-02T08:00:00Z" };
  apiMocks.listIntakeSubmissions.mockResolvedValue({ items: [voidedSummary], total: 1 });
  apiMocks.getIntakeSubmission.mockResolvedValue(voidedDetail);
  apiMocks.updateIntakeSubmissionListState
    .mockResolvedValueOnce(removedDetail)
    .mockResolvedValueOnce(voidedDetail);
  renderPage();

  fireEvent.click(await screen.findByRole("button", { name: "从列表移除" }));
  await waitFor(() => expect(apiMocks.updateIntakeSubmissionListState).toHaveBeenCalledWith(
    9,
    true,
    revision,
  ));
  expect(await screen.findByRole("button", { name: "恢复到当前列表" })).toBeInTheDocument();
  expect(within(screen.getByLabelText("提交记录列表")).getByText("P10 后台虚构客户")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "恢复到当前列表" }));
  await waitFor(() => expect(apiMocks.updateIntakeSubmissionListState).toHaveBeenLastCalledWith(
    9,
    false,
    revision,
  ));
  expect(await screen.findByRole("button", { name: "从列表移除" })).toBeInTheDocument();
});

it("shows the full editable review while keeping the submission list privacy-minimized", async () => {
  renderPage();

  expect(await screen.findByLabelText("详细地址", {}, { timeout: 5_000 })).toHaveValue("虚构后台测试地址");
  expect(screen.getByLabelText("门禁说明")).toHaveValue("虚构敏感入户说明");
  expect(screen.getByLabelText("钥匙编号")).toHaveValue("TEST-KEY");
  expect(screen.getByText("查看客户原始提交（永久只读）")).toBeInTheDocument();
  expect(screen.getByText("处理记录")).toBeInTheDocument();
  expect(screen.getByText("客户提交资料")).toBeInTheDocument();
  const list = screen.getByLabelText("提交记录列表");
  expect(within(list).getByText("P10 后台虚构客户")).toBeInTheDocument();
  expect(within(list).queryByText("TEST-CONTACT")).not.toBeInTheDocument();
  expect(within(list).queryByText("虚构敏感入户说明")).not.toBeInTheDocument();
  expect(within(list).queryByText("TEST-KEY")).not.toBeInTheDocument();
  expect(screen.getByText(/链接原文只在生成时返回/)).toBeInTheDocument();
  expect(screen.getByText(/链接原文未保存/)).toBeInTheDocument();
});

it("copies the public note into the chosen review destinations without changing the original", async () => {
  renderPage();

  expect(await screen.findByText("客户填写的待审核备注")).toBeInTheDocument();
  const customerNotes = screen.getByRole("textbox", { name: "客户备注" });
  const orderNotes = screen.getByRole("textbox", { name: "本次订单备注" });
  expect(orderNotes).toHaveValue("");

  fireEvent.click(screen.getByRole("button", { name: "填入客户长期备注" }));
  fireEvent.click(screen.getByRole("button", { name: "填入本次订单备注" }));

  expect(customerNotes).toHaveValue("虚构待审核备注内容");
  expect(orderNotes).toHaveValue("虚构待审核备注内容");
  fireEvent.click(screen.getByRole("button", { name: "保存审核稿" }));
  await waitFor(() => expect(apiMocks.saveIntakeReviewDraft).toHaveBeenCalledWith(
    9,
    expect.objectContaining({
      customer: expect.objectContaining({ notes: "虚构待审核备注内容" }),
      notes: "虚构待审核备注内容",
    }),
    null,
    revision,
  ));
  expect(detail.payload.customer.notes).toBeNull();
});

it("creates a link and copies the browser-origin URL", async () => {
  renderPage();
  await screen.findByText("链接 #7");

  fireEvent.change(screen.getByRole("spinbutton", { name: "有效天数" }), { target: { value: "21" } });
  fireEvent.click(screen.getByRole("button", { name: "生成链接" }));
  await waitFor(() => expect(apiMocks.createIntakeToken).toHaveBeenCalledWith(21));
  expect(await screen.findByText("链接 #8")).toBeInTheDocument();
  expect(screen.getByText(/新链接仅本次可查看/)).toBeInTheDocument();

  fireEvent.click(screen.getAllByRole("button", { name: "复制" })[0]);
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
    `${window.location.origin}/f/P10-test-token`,
  ));
});

it("saves a review and archives an order only through explicit admin actions", async () => {
  const convertedDetail: IntakeSubmissionDetail = {
    ...detail,
    status: "archived_order",
    review_payload: payload,
    review_unit_price: "30.00",
    reviewed_at: timestamp,
    converted_at: timestamp,
    converted_customer_id: 3,
    converted_order_id: 4,
    decision_mode: "order",
    decision_idempotency_key: "decision-test-key-0001",
    revision: "c".repeat(64),
  };
  apiMocks.getIntakeSubmission
    .mockReset()
    .mockResolvedValueOnce(detail)
    .mockResolvedValue(convertedDetail);

  renderPage();
  const nameInput = await screen.findByLabelText("联系人名称");
  fireEvent.change(nameInput, { target: { value: "后台修订客户" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "每次价格（元）" }), { target: { value: "30" } });
  fireEvent.click(screen.getByRole("button", { name: "保存审核稿" }));
  await waitFor(() => expect(apiMocks.saveIntakeReviewDraft).toHaveBeenCalledWith(
    9,
    expect.objectContaining({
      customer: expect.objectContaining({ name: "后台修订客户" }),
    }),
    "30.00",
    revision,
  ));

  fireEvent.click(await screen.findByRole("button", { name: "归档并生成订单" }));
  const confirmDialog = screen.getByRole("alertdialog", { name: "确认审核动作" });
  expect(apiMocks.decideIntakeSubmission).not.toHaveBeenCalled();
  fireEvent.click(within(confirmDialog).getByRole("button", { name: "确认执行" }));
  await waitFor(() => expect(apiMocks.decideIntakeSubmission).toHaveBeenCalledWith(9, "order", "b".repeat(64), expect.any(String)));
  await waitFor(() => expect(apiMocks.getIntakeSubmission).toHaveBeenCalledTimes(2));
  expect(await screen.findByText(/已完成本机幂等归档/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "查看客户 #3" })).toHaveAttribute("href", "/admin/customers");
  expect(screen.getByRole("link", { name: "查看订单 #4" })).toHaveAttribute("href", "/admin/orders");
});
