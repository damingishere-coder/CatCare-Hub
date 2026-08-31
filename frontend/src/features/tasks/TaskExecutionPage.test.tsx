import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { TaskExecutionPage } from "./TaskExecutionPage";
import { TaskApiError } from "./api";
import type { TaskExecutionDetail } from "./types";

const apiMocks = vi.hoisted(() => ({
  getTaskExecution: vi.fn(),
  startTaskExecution: vi.fn(),
  updateTaskChecklist: vi.fn(),
  saveTaskText: vi.fn(),
  uploadTaskPhoto: vi.fn(),
  completeTaskExecution: vi.fn(),
  markTaskException: vi.fn(),
  taskPhotoUrl: (url: string) => url,
  TaskApiError: class extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("./api", () => apiMocks);

const revisionA = "a".repeat(64);
const revisionB = "b".repeat(64);
const revisionC = "c".repeat(64);
const revisionD = "d".repeat(64);

const confirmed: TaskExecutionDetail = {
  id: 7,
  order_id: 3,
  service_date: "2035-10-06",
  planned_time: "09:30:00",
  status: "confirmed",
  started_at: null,
  completed_at: null,
  photos_sent_at: null,
  notes: null,
  cat_status: null,
  exception_notes: null,
  revision: revisionA,
  order_status: "confirmed",
  order_notes: "虚构订单备注",
  customer: {
    id: 2,
    name: "P6 虚构客户",
    phone: "000-P6-TEST",
    community: "P6 虚构小区",
    address: "P6 虚构路 6 号",
    building: "6 栋",
    unit: "6 单元",
    room: "606",
    access_method: null,
    community_access_method: "小区门卡",
    building_access_method: "楼下钥匙",
    access_info: "虚构门禁说明",
    key_status: "虚构钥匙状态",
    key_code: "FAKE-P6-KEY",
  },
  cats: [{
    id: 5,
    name: "P6 虚构猫咪",
    food: "虚构主粮",
    food_preference: "虚构偏好",
    litter_type: "虚构猫砂",
    medication_required: true,
    medication_notes: "虚构用药说明",
    special_notes: "虚构注意事项",
    service_notes: "虚构服务说明",
    is_active: true,
  }],
  items: [
    { id: 11, item_type: "feed", required: true, completed: false },
    { id: 12, item_type: "photo", required: true, completed: false },
  ],
  photos: [],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/tasks/7"]}>
      <Routes>
        <Route path="/admin/tasks/:id" element={<TaskExecutionPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.getTaskExecution.mockResolvedValue(confirmed);
  apiMocks.startTaskExecution.mockResolvedValue({
    ...confirmed,
    status: "in_progress",
    order_status: "in_progress",
    started_at: "2035-10-06T01:31:00Z",
    revision: revisionB,
  });
});

it("shows the single-task field context and starts a confirmed task", async () => {
  renderPage();

  expect(await screen.findByText("P6 虚构客户")).toBeInTheDocument();
  expect(screen.getByText(/P6 虚构路 6 号/)).toBeInTheDocument();
  expect(screen.queryByText("000-P6-TEST")).not.toBeInTheDocument();
  expect(screen.getByText("小区门卡")).toBeInTheDocument();
  expect(screen.getByText("楼下钥匙")).toBeInTheDocument();
  expect(screen.queryByText(/敏感信息/)).not.toBeInTheDocument();
  expect(screen.queryByText(/虚构门禁说明/)).not.toBeInTheDocument();
  expect(screen.getByText(/虚构用药说明/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "返回路线图" })).toHaveAttribute("href", "/admin/routes");

  fireEvent.click(screen.getByRole("button", { name: "开始本次服务" }));
  await waitFor(() => expect(apiMocks.startTaskExecution).toHaveBeenCalledWith(7, {
    expected_revision: revisionA,
  }));
  expect(await screen.findByText("进行中")).toBeInTheDocument();
  expect(screen.getByLabelText("猫咪状态")).toBeEnabled();
});

it("completes checklist, saves text, uploads a photo, and finishes", async () => {
  const running = {
    ...confirmed,
    status: "in_progress" as const,
    order_status: "in_progress" as const,
    started_at: "2035-10-06T01:31:00Z",
  };
  apiMocks.getTaskExecution.mockResolvedValue(running);
  apiMocks.updateTaskChecklist.mockResolvedValue({
    ...running,
    revision: revisionB,
    items: running.items.map((item) => item.id === 11 ? { ...item, completed: true } : item),
  });
  apiMocks.uploadTaskPhoto.mockResolvedValue({
    ...running,
    revision: revisionC,
    items: running.items.map((item) => ({ ...item, completed: true })),
    photos: [{ id: 21, url: "/api/admin/tasks/7/photos/21", created_at: "2035-10-06T01:40:00Z" }],
  });
  apiMocks.saveTaskText.mockResolvedValue({
    ...running,
    revision: revisionD,
    items: running.items.map((item) => ({ ...item, completed: true })),
    photos: [{ id: 21, url: "/api/admin/tasks/7/photos/21", created_at: "2035-10-06T01:40:00Z" }],
    notes: "已完成全部服务",
    cat_status: "精神良好",
  });
  apiMocks.completeTaskExecution.mockResolvedValue({
    ...running,
    status: "completed",
    order_status: "completed",
    completed_at: "2035-10-06T02:00:00Z",
    revision: "e".repeat(64),
    items: running.items.map((item) => ({ ...item, completed: true })),
    photos: [{ id: 21, url: "/api/admin/tasks/7/photos/21", created_at: "2035-10-06T01:40:00Z" }],
    notes: "已完成全部服务",
    cat_status: "精神良好",
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  renderPage();
  await screen.findByText("P6 虚构客户");

  fireEvent.click(screen.getByLabelText("添粮（必做）"));
  await waitFor(() => expect(apiMocks.updateTaskChecklist).toHaveBeenCalledWith(7, 11, {
    expected_revision: revisionA,
    completed: true,
  }));

  const file = new File(["synthetic"], "synthetic.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText("选择任务照片"), { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: "上传图片" }));
  await waitFor(() => expect(apiMocks.uploadTaskPhoto).toHaveBeenCalledWith(7, revisionB, file));
  expect(await screen.findByAltText("任务照片 1")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("猫咪状态"), { target: { value: "精神良好" } });
  fireEvent.change(screen.getByLabelText("本次备注"), { target: { value: "已完成全部服务" } });
  fireEvent.click(screen.getByRole("button", { name: "保存执行记录" }));
  await waitFor(() => expect(apiMocks.saveTaskText).toHaveBeenCalledWith(7, {
    expected_revision: revisionC,
    notes: "已完成全部服务",
    cat_status: "精神良好",
  }));

  fireEvent.click(screen.getByRole("button", { name: "完成本次服务" }));
  await waitFor(() => expect(apiMocks.completeTaskExecution).toHaveBeenCalledWith(7, {
    expected_revision: revisionD,
  }));
  expect(await screen.findByText("已完成")).toBeInTheDocument();
  expect(screen.getByText("该任务已进入终态，执行记录为只读。")).toBeInTheDocument();
});

it("locks controls after a stale exception request", async () => {
  const running = {
    ...confirmed,
    status: "in_progress" as const,
    order_status: "in_progress" as const,
    started_at: "2035-10-06T01:31:00Z",
  };
  apiMocks.getTaskExecution.mockResolvedValue(running);
  apiMocks.markTaskException.mockRejectedValue(new TaskApiError(409, "任务执行记录已更新"));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  renderPage();
  await screen.findByText("P6 虚构客户");

  fireEvent.change(screen.getByLabelText("异常情况"), {
    target: { value: "虚构异常情况" },
  });
  fireEvent.click(screen.getByRole("button", { name: "标记异常并结束" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(/请刷新任务后再继续/);
  expect(screen.getByText(/刷新前所有执行按钮已锁定/)).toBeInTheDocument();
  expect(screen.getByLabelText("添粮（必做）")).toBeDisabled();
  expect(screen.getByRole("button", { name: "刷新任务" })).toBeInTheDocument();
});
