import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { MobileTaskPage } from "./MobileTaskPage";
import { MobileApiError } from "./api";
import type { MobileTaskExecutionDetail } from "./types";

const apiMocks = vi.hoisted(() => ({
  getMobileTask: vi.fn(),
  startMobileTask: vi.fn(),
  updateMobileChecklist: vi.fn(),
  saveMobileTaskText: vi.fn(),
  uploadMobileTaskPhoto: vi.fn(),
  completeMobileTask: vi.fn(),
  mobilePhotoUrl: (url: string) => url,
  MobileApiError: class extends Error {
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

const confirmed: MobileTaskExecutionDetail = {
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
  order_notes: "虚构订单服务备注",
  navigation_url: "https://uri.amap.com/navigation?to=120,30,test",
  navigation_state: "ready",
  customer: {
    id: 2,
    name: "P9 虚构客户",
    phone: "000-P9-TEST",
    community: "P9 虚构小区",
    address: "P9 虚构路 9 号",
    building: "9 栋",
    unit: "9 单元",
    room: "909",
    access_method: null,
    community_access_method: "小区门卡",
    building_access_method: "楼下钥匙",
    access_info: "虚构门禁说明",
    key_status: "虚构钥匙状态",
    key_code: "FAKE-P9-KEY",
  },
  cats: [{
    id: 5,
    name: "P9 虚构猫咪",
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
    <MemoryRouter initialEntries={["/mobile/tasks/7"]}>
      <Routes>
        <Route path="/mobile/tasks/:id" element={<MobileTaskPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.getMobileTask.mockResolvedValue(confirmed);
});

it("shows the two access fields on detail and starts a confirmed task", async () => {
  apiMocks.startMobileTask.mockResolvedValue({
    ...confirmed,
    status: "in_progress",
    order_status: "in_progress",
    started_at: "2035-10-06T01:31:00Z",
    revision: revisionB,
  });
  renderPage();

  expect(await screen.findByText("P9 虚构客户")).toBeInTheDocument();
  expect(screen.getByText(/P9 虚构路 9 号/)).toBeInTheDocument();
  expect(screen.queryByText("000-P9-TEST")).not.toBeInTheDocument();
  expect(screen.getByText("小区门卡")).toBeInTheDocument();
  expect(screen.getByText("楼下钥匙")).toBeInTheDocument();
  expect(screen.queryByText(/敏感信息/)).not.toBeInTheDocument();
  expect(screen.queryByText(/虚构门禁说明/)).not.toBeInTheDocument();
  expect(screen.getByText(/虚构用药说明/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "一键导航" })).toHaveAttribute("href", confirmed.navigation_url);

  fireEvent.click(screen.getByRole("button", { name: "开始任务" }));
  await waitFor(() => expect(apiMocks.startMobileTask).toHaveBeenCalledWith(7, {
    expected_revision: revisionA,
  }));
  expect(await screen.findByText("进行中")).toBeInTheDocument();
  expect(screen.getByLabelText("猫咪状态")).toBeEnabled();
});

it("completes checklist, photo, notes, and the task with fresh revisions", async () => {
  const running: MobileTaskExecutionDetail = {
    ...confirmed,
    status: "in_progress",
    order_status: "in_progress",
    started_at: "2035-10-06T01:31:00Z",
  };
  apiMocks.getMobileTask.mockResolvedValue(running);
  apiMocks.updateMobileChecklist.mockResolvedValue({
    ...running,
    revision: revisionB,
    items: running.items.map((item) => item.id === 11 ? { ...item, completed: true } : item),
  });
  apiMocks.uploadMobileTaskPhoto.mockResolvedValue({
    ...running,
    revision: revisionC,
    items: running.items.map((item) => ({ ...item, completed: true })),
    photos: [{ id: 21, url: "/api/mobile/tasks/7/photos/21", created_at: "2035-10-06T01:40:00Z" }],
  });
  apiMocks.saveMobileTaskText.mockResolvedValue({
    ...running,
    revision: revisionD,
    items: running.items.map((item) => ({ ...item, completed: true })),
    photos: [{ id: 21, url: "/api/mobile/tasks/7/photos/21", created_at: "2035-10-06T01:40:00Z" }],
    notes: "已完成全部服务",
    cat_status: "精神良好",
  });
  apiMocks.completeMobileTask.mockResolvedValue({
    ...running,
    status: "completed",
    order_status: "completed",
    completed_at: "2035-10-06T02:00:00Z",
    revision: "e".repeat(64),
    items: running.items.map((item) => ({ ...item, completed: true })),
    photos: [{ id: 21, url: "/api/mobile/tasks/7/photos/21", created_at: "2035-10-06T01:40:00Z" }],
    notes: "已完成全部服务",
    cat_status: "精神良好",
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  renderPage();
  await screen.findByText("P9 虚构客户");

  fireEvent.click(screen.getByLabelText("添粮（必做）"));
  await waitFor(() => expect(apiMocks.updateMobileChecklist).toHaveBeenCalledWith(7, 11, {
    expected_revision: revisionA,
    completed: true,
  }));

  const file = new File(["synthetic"], "synthetic.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText("拍摄或选择现场照片"), { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: "上传图片" }));
  await waitFor(() => expect(apiMocks.uploadMobileTaskPhoto).toHaveBeenCalledWith(7, revisionB, file));
  expect(await screen.findByAltText("现场照片 1")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("猫咪状态"), { target: { value: "精神良好" } });
  fireEvent.change(screen.getByLabelText("本次备注"), { target: { value: "已完成全部服务" } });
  fireEvent.click(screen.getByRole("button", { name: "保存现场记录" }));
  await waitFor(() => expect(apiMocks.saveMobileTaskText).toHaveBeenCalledWith(7, {
    expected_revision: revisionC,
    notes: "已完成全部服务",
    cat_status: "精神良好",
  }));

  fireEvent.click(screen.getByRole("button", { name: "完成本次服务" }));
  await waitFor(() => expect(apiMocks.completeMobileTask).toHaveBeenCalledWith(7, {
    expected_revision: revisionD,
  }));
  expect(await screen.findByText("已完成")).toBeInTheDocument();
  expect(screen.getByText("任务已结束，现场记录现为只读。")).toBeInTheDocument();
});

it("locks write controls after a stale revision conflict", async () => {
  const running: MobileTaskExecutionDetail = {
    ...confirmed,
    status: "in_progress",
    order_status: "in_progress",
  };
  apiMocks.getMobileTask.mockResolvedValue(running);
  apiMocks.updateMobileChecklist.mockRejectedValue(new MobileApiError(409, "任务执行记录已更新"));
  renderPage();
  await screen.findByText("P9 虚构客户");

  fireEvent.click(screen.getByLabelText("添粮（必做）"));

  expect(await screen.findByRole("alert")).toHaveTextContent(/请刷新任务后再继续/);
  expect(screen.getByText(/刷新前所有执行按钮已锁定/)).toBeInTheDocument();
  expect(screen.getByLabelText("添粮（必做）")).toBeDisabled();
});


it("protects unsaved notes when refresh is cancelled and clears them only after an explicit discard", async () => {
  apiMocks.getMobileTask.mockResolvedValue({ ...confirmed, status: "in_progress" });
  renderPage();
  await screen.findByText("P9 虚构客户");
  fireEvent.change(screen.getByLabelText("本次备注"), { target: { value: "尚未保存的现场记录" } });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: "刷新任务" }));
  expect(confirm).toHaveBeenCalled();
  expect(apiMocks.getMobileTask).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("本次备注")).toHaveValue("尚未保存的现场记录");
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "刷新任务" }));
  await waitFor(() => expect(apiMocks.getMobileTask).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByLabelText("本次备注")).toHaveValue(""));
  confirm.mockRestore();
});

it("lists remaining service items and does not complete while a photo is awaiting upload", async () => {
  apiMocks.getMobileTask.mockResolvedValue({ ...confirmed, status: "in_progress", items: confirmed.items.map((item) => ({ ...item, completed: true })) });
  renderPage();
  await screen.findByText("P9 虚构客户");
  const complete = screen.getByRole("button", { name: "完成本次服务" });
  expect(complete.closest("footer")).not.toBeNull();
  expect(complete).toBeEnabled();
  fireEvent.change(screen.getByLabelText("拍摄或选择现场照片"), { target: { files: [new File(["test"], "test.png", { type: "image/png" })] } });
  expect(complete).toBeDisabled();
  expect(screen.getByText("请先上传已选照片")).toBeInTheDocument();
  expect(apiMocks.completeMobileTask).not.toHaveBeenCalled();
});
