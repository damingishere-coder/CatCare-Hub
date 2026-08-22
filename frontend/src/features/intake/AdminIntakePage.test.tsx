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
  reviewIntakeSubmission: vi.fn(),
  convertIntakeSubmission: vi.fn(),
}));

vi.mock("./api", () => apiMocks);

const timestamp = "2031-05-01T08:00:00Z";
const revision = "a".repeat(64);
const token: IntakeTokenRead = {
  id: 7,
  status: "active",
  expires_at: "2031-05-15T08:00:00Z",
  submitted_at: timestamp,
  fill_path: "/fill/P10-test-token",
  submission_status: "submitted",
  revision,
  created_at: timestamp,
};
const summary: IntakeSubmissionSummary = {
  id: 9,
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
  reviewed_at: null,
  converted_at: null,
  converted_customer_id: null,
  converted_order_id: null,
};

function renderPage() {
  return render(<MemoryRouter><AdminIntakePage /></MemoryRouter>);
}

beforeEach(() => {
  vi.resetAllMocks();
  apiMocks.listIntakeTokens.mockResolvedValue({ items: [token], total: 1 });
  apiMocks.listIntakeSubmissions.mockResolvedValue({ items: [summary], total: 1 });
  apiMocks.getIntakeSubmission.mockResolvedValue(detail);
  apiMocks.createIntakeToken.mockResolvedValue({ ...token, id: 8, submitted_at: null, submission_status: null });
  apiMocks.updateIntakeToken.mockResolvedValue({ ...token, status: "disabled", submitted_at: null, submission_status: null });
  apiMocks.reviewIntakeSubmission.mockResolvedValue({ ...detail, status: "reviewed", reviewed_at: timestamp, revision: "b".repeat(64) });
  apiMocks.convertIntakeSubmission.mockResolvedValue({ submission_id: 9, status: "converted", customer_id: 3, order_id: 4, revision: "c".repeat(64) });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

it("keeps sensitive fields out of the summary list and shows them in selected detail", async () => {
  renderPage();

  expect(await screen.findByText("虚构敏感入户说明")).toBeInTheDocument();
  const list = screen.getByLabelText("提交记录列表");
  expect(within(list).getByText("P10 后台虚构客户")).toBeInTheDocument();
  expect(within(list).queryByText("TEST-CONTACT")).not.toBeInTheDocument();
  expect(within(list).queryByText("虚构敏感入户说明")).not.toBeInTheDocument();
  expect(within(list).queryByText("TEST-KEY")).not.toBeInTheDocument();
  expect(screen.getByText(/当前尚未完成 P12 正式登录/)).toBeInTheDocument();
});

it("creates a link and copies the browser-origin URL", async () => {
  renderPage();
  await screen.findByText("链接 #7");

  fireEvent.change(screen.getByRole("spinbutton", { name: "有效天数" }), { target: { value: "21" } });
  fireEvent.click(screen.getByRole("button", { name: "生成链接" }));
  await waitFor(() => expect(apiMocks.createIntakeToken).toHaveBeenCalledWith(21));
  expect(await screen.findByText("链接 #8")).toBeInTheDocument();

  fireEvent.click(screen.getAllByRole("button", { name: "复制" })[0]);
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
    `${window.location.origin}/fill/P10-test-token`,
  ));
});

it("reviews and converts only through explicit admin actions", async () => {
  const convertedDetail: IntakeSubmissionDetail = {
    ...detail,
    status: "converted",
    reviewed_at: timestamp,
    converted_at: timestamp,
    converted_customer_id: 3,
    converted_order_id: 4,
    revision: "c".repeat(64),
  };
  apiMocks.getIntakeSubmission
    .mockResolvedValueOnce(detail)
    .mockResolvedValueOnce(convertedDetail);

  renderPage();
  await screen.findByText("虚构敏感入户说明");
  fireEvent.click(screen.getByRole("button", { name: "标记已审核" }));
  await waitFor(() => expect(apiMocks.reviewIntakeSubmission).toHaveBeenCalledWith(9, revision));

  fireEvent.click(await screen.findByRole("button", { name: "确认并创建订单" }));
  expect(screen.getByRole("alertdialog", { name: "确认创建正式记录" })).toBeInTheDocument();
  expect(apiMocks.convertIntakeSubmission).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "再次确认创建" }));
  await waitFor(() => expect(apiMocks.convertIntakeSubmission).toHaveBeenCalledWith(9, "b".repeat(64)));
  expect(await screen.findByText(/已完成转换/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "查看客户 #3" })).toHaveAttribute("href", "/admin/customers");
  expect(screen.getByRole("link", { name: "查看订单 #4" })).toHaveAttribute("href", "/admin/plans?view=orders");
});
