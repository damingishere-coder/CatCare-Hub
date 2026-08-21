import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { MobileTodayPage } from "./MobileTodayPage";
import type { MobileTodayRead } from "./types";

const apiMocks = vi.hoisted(() => ({
  getMobileToday: vi.fn(),
}));

vi.mock("./api", () => apiMocks);

const today: MobileTodayRead = {
  business_date: "2035-10-06",
  task_count: 2,
  open_task_count: 1,
  completed_task_count: 1,
  tasks: [
    {
      id: 7,
      order_id: 3,
      sequence: 1,
      sort_order: 0,
      planned_time: "09:30:00",
      status: "in_progress",
      customer_name: "P9 虚构客户甲",
      community: "P9 虚构小区甲",
      cat_count: 2,
      navigation_url: "https://uri.amap.com/navigation?to=120,30,test",
      navigation_state: "ready",
    },
    {
      id: 8,
      order_id: 4,
      sequence: 2,
      sort_order: 1,
      planned_time: null,
      status: "completed",
      customer_name: "P9 虚构客户乙",
      community: null,
      cat_count: 1,
      navigation_url: null,
      navigation_state: "missing_coordinates",
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.getMobileToday.mockResolvedValue(today);
});

function renderPage() {
  return render(
    <MemoryRouter>
      <MobileTodayPage />
    </MemoryRouter>,
  );
}

it("shows the ordered route, safe summaries, navigation, and refresh", async () => {
  renderPage();

  expect(await screen.findByText("P9 虚构客户甲")).toBeInTheDocument();
  expect(screen.getByText("P9 虚构客户乙")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "一键导航" })).toHaveAttribute(
    "href",
    today.tasks[0].navigation_url,
  );
  expect(screen.getByText("地址坐标尚未在电脑计划页解析")).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "查看任务" })[0]).toHaveAttribute("href", "/mobile/tasks/7");
  expect(screen.getByText(/正式登录与权限隔离将在 P12 完成/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "刷新今日任务" }));
  await waitFor(() => expect(apiMocks.getMobileToday).toHaveBeenCalledTimes(2));
});

it("shows a stable empty state", async () => {
  apiMocks.getMobileToday.mockResolvedValue({
    ...today,
    task_count: 0,
    open_task_count: 0,
    completed_task_count: 0,
    tasks: [],
  });
  renderPage();

  expect(await screen.findByText("今天没有待展示的任务")).toBeInTheDocument();
});
