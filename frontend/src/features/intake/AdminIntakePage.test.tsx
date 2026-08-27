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
  apiMocks.createIntakeToken.mockResolvedValue({ ...token, id: 8, fill_path: "/fill/P10-test-token", submitted_at: null, submission_status: null });
  apiMocks.updateIntakeToken.mockResolvedValue({ ...token, status: "disabled", submitted_at: null, submission_status: null });
  apiMocks.saveIntakeReviewDraft.mockResolvedValue({ ...detail, status: "reviewed", review_payload: payload, review_unit_price: "30.00", reviewed_at: timestamp, revision: "b".repeat(64) });
  apiMocks.decideIntakeSubmission.mockResolvedValue({ submission_id: 9, submission_uuid: summary.submission_uuid, status: "archived_order", decision_mode: "order", customer_id: 3, order_id: 4, revision: "c".repeat(64) });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
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
    `${window.location.origin}/fill/P10-test-token`,
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
