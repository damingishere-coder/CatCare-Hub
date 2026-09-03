import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { DailyPlansPage } from "./DailyPlansPage";
import type {
  DayPlan,
  PlanRouteWorkspace,
  PlanTaskDetail,
  PlanTaskSummary,
} from "./types";

const apiMocks = vi.hoisted(() => ({
  getPlanDays: vi.fn(),
  getDayPlan: vi.fn(),
  getPlanRoute: vi.fn(),
  getPlanTask: vi.fn(),
  previewPlanRoute: vi.fn(),
  saveDaySchedule: vi.fn(),
  updatePlanTaskStatus: vi.fn(),
}));

vi.mock("./api", () => apiMocks);

function renderPage(onDirtyChange = vi.fn(), initialEntry = "/admin/routes") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <DailyPlansPage onDirtyChange={onDirtyChange} />
    </MemoryRouter>,
  );
}

const revisionA = "a".repeat(64);
const revisionB = "b".repeat(64);

function task(
  id: number,
  customerName: string,
  sortOrder: number,
): PlanTaskSummary {
  return {
    id,
    order_id: id,
    order_number: id + 100,
    service_date: "2034-10-01",
    planned_time: id === 1 ? "09:30:00" : null,
    sort_order: sortOrder,
    status: "confirmed",
    customer: {
      id,
      name: customerName,
      community: `虚构小区 ${id}`,
      address: `虚构完整地址 ${id}`,
    },
    cat_count: 1,
    cats: [{ id, name: `虚构猫 ${id}` }],
    items: [
      { item_type: "feed", required: true, completed: false },
      { item_type: "water", required: true, completed: false },
    ],
    has_execution_history: false,
  };
}

const tasks = [
  task(1, "P4 第一位虚构客户", 0),
  task(2, "P4 第二位虚构客户", 1),
  task(3, "P4 第三位虚构客户", 2),
];

const dayPlan: DayPlan = {
  service_date: "2034-10-01",
  task_count: 3,
  order_count: 3,
  cat_count: 3,
  revision: revisionA,
  schedule_locked: false,
  tasks,
};

const routeWorkspace: PlanRouteWorkspace = {
  service_date: "2034-10-01",
  revision: revisionA,
  schedule_locked: false,
  transport_mode: "electrobike",
  provider: {
    name: "amap",
    configured: true,
    coordinate_system: "GCJ-02",
    message: null,
  },
  route_mode: "round_trip",
  start: {
    label: "家",
    position: { latitude: 30, longitude: 120 },
  },
  markers: tasks.map((planTask, index) => ({
    task_id: planTask.id,
    order_number: planTask.order_number,
    sequence: index + 1,
    customer_name: planTask.customer.name,
    community: planTask.customer.community,
    address: planTask.customer.address,
    position: { latitude: 30 + (index + 1) / 10, longitude: 120 + (index + 1) / 10 },
    navigation_url: `https://uri.amap.com/navigation?to=${index + 1}`,
  })),
  unresolved_tasks: [],
  optimization: null,
  road_route: {
    status: "not_generated",
    path: null,
    message: null,
  },
  can_adopt_recommendation: false,
};

const previewWorkspace: PlanRouteWorkspace = {
  ...routeWorkspace,
  revision: revisionB,
  optimization: {
    method: "exact",
    planned_time_policy: "precedence",
    baseline_task_ids: [1, 2, 3],
    optimized_task_ids: [3, 2, 1],
    baseline_estimated_distance_meters: 12600,
    optimized_estimated_distance_meters: 9800,
    estimated_savings_percent: 22.2,
  },
  road_route: {
    status: "ready",
    path: {
      task_ids: [3, 2, 1],
      distance_meters: 9800,
      duration_seconds: 2220,
      polyline: [routeWorkspace.start!.position, ...[...routeWorkspace.markers].reverse().map((marker) => marker.position), routeWorkspace.start!.position],
    },
    message: "高德已计算优化顺序的真实电动车闭环路线",
  },
  can_adopt_recommendation: true,
};

function detailFor(planTask: PlanTaskSummary): PlanTaskDetail {
  return {
    task: planTask,
    day_revision: revisionA,
    customer: {
      ...planTask.customer,
      address: "虚构路 100 号",
      building: "3 栋",
      unit: "2 单元",
      room: "1602",
    },
    cats: planTask.cats.map((cat) => ({
      ...cat,
      is_active: true,
      medication_required: true,
      medication_notes: "虚构用药说明",
      special_notes: "虚构特殊情况",
      service_notes: "虚构服务注意事项",
    })),
    order_status: "confirmed",
    payment_status: "unpaid",
    order_notes: "虚构订单备注",
    task_notes: null,
    estimated_arrival: null,
    photo_count: 0,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  apiMocks.getPlanDays.mockResolvedValue({
    items: [
      {
        service_date: "2034-10-01",
        task_count: 3,
        order_count: 3,
        cat_count: 3,
        customer_names: tasks.map((entry) => entry.customer.name),
      },
    ],
    total: 1,
  });
  apiMocks.getDayPlan.mockResolvedValue(dayPlan);
  apiMocks.getPlanRoute.mockResolvedValue(routeWorkspace);
  apiMocks.previewPlanRoute.mockResolvedValue(previewWorkspace);
  apiMocks.getPlanTask.mockImplementation(async (taskId: number) => {
    const selected = tasks.find((entry) => entry.id === taskId);
    if (!selected) throw new Error("测试任务不存在");
    return detailFor(selected);
  });
  apiMocks.saveDaySchedule.mockImplementation(async (_date: string, payload: { tasks: Array<{ task_id: number; planned_time: string | null }> }) => {
    const savedTasks = payload.tasks.map((entry, index) => ({
      ...tasks.find((planTask) => planTask.id === entry.task_id)!,
      planned_time: entry.planned_time,
      sort_order: index,
    }));
    return { ...dayPlan, revision: revisionB, tasks: savedTasks };
  });
  apiMocks.updatePlanTaskStatus.mockImplementation(async (taskId: number) => ({
    ...detailFor(tasks.find((entry) => entry.id === taskId)!),
    day_revision: revisionB,
    task: { ...tasks.find((entry) => entry.id === taskId)!, status: "ready" },
  }));
});

it("shows date tasks, route workspace, and a privacy-minimized selected detail", async () => {
  renderPage();

  expect((await screen.findAllByText("P4 第一位虚构客户")).length).toBeGreaterThan(0);
  expect(screen.getByRole("heading", { name: "路线地图" })).toBeInTheDocument();
  expect(screen.getByText("高德后端：已配置")).toBeInTheDocument();
  expect(screen.getByText("街道底图：未配置")).toBeInTheDocument();
  expect(screen.getByText("闭环：家 → 客户 → 家")).toBeInTheDocument();
  expect(screen.getByText(/先用当天全部已验证地址做闭环全局优化/)).toBeInTheDocument();
  expect(screen.getByText(/另 1 位/)).toBeInTheDocument();
  expect(await screen.findByText("未配置街道底图，按真实坐标展示")).toBeInTheDocument();
  expect(await screen.findByRole("link", { name: "打开高德导航" })).toHaveAttribute(
    "href",
    "https://uri.amap.com/navigation?to=1",
  );
  expect(screen.getByRole("link", { name: "进入任务执行" })).toHaveAttribute(
    "href",
    "/admin/tasks/1",
  );
  expect(await screen.findByText(/虚构路 100 号/)).toBeInTheDocument();
  expect(screen.getByText("服务：虚构服务注意事项")).toBeInTheDocument();
  expect(screen.queryByText("000-PLAN-TEST")).not.toBeInTheDocument();
  expect(apiMocks.getDayPlan).toHaveBeenCalledWith("2034-10-01");
  expect(apiMocks.getPlanRoute).toHaveBeenCalledWith("2034-10-01");
  expect(apiMocks.getPlanTask).toHaveBeenCalledWith(1);
});

it("opens the exact service date and task from an order route link", async () => {
  renderPage(vi.fn(), "/admin/routes?date=2034-10-01&task_id=2");

  expect((await screen.findAllByText("P4 第二位虚构客户")).length).toBeGreaterThan(0);
  await waitFor(() => expect(apiMocks.getDayPlan).toHaveBeenCalledWith("2034-10-01"));
  await waitFor(() => expect(apiMocks.getPlanTask).toHaveBeenCalledWith(2));
});

it("ends route loading after failure, reports unknown status, and retries", async () => {
  apiMocks.getPlanRoute
    .mockRejectedValueOnce(new TypeError("路线服务暂时断开"))
    .mockResolvedValueOnce(routeWorkspace);
  renderPage();

  expect(await screen.findByRole("alert")).toHaveTextContent("路线服务暂时断开");
  expect(screen.queryByText("正在加载路线数据…")).not.toBeInTheDocument();
  expect(screen.getByText("高德后端：状态未知")).toBeInTheDocument();
  expect(screen.getByText("真实道路：待规划")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "重试" }));

  expect(await screen.findByText("高德后端：已配置")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("moves tasks, edits time, and saves one revision-protected day schedule", async () => {
  const onDirtyChange = vi.fn();
  renderPage(onDirtyChange);
  expect((await screen.findAllByText("P4 第二位虚构客户")).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "拖动任务 #1 排序" })).toBeEnabled();

  fireEvent.click(screen.getByRole("button", { name: "上移 P4 第二位虚构客户 任务" }));
  fireEvent.change(screen.getByLabelText("任务 #2 计划时间"), {
    target: { value: "10:15" },
  });
  expect(screen.getByText("未保存")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "保存排程" }));

  await waitFor(() => expect(apiMocks.saveDaySchedule).toHaveBeenCalledTimes(1));
  expect(apiMocks.saveDaySchedule).toHaveBeenCalledWith("2034-10-01", {
    expected_revision: revisionA,
    tasks: [
      { task_id: 2, planned_time: "10:15" },
      { task_id: 1, planned_time: "09:30" },
      { task_id: 3, planned_time: null },
    ],
  });
  await waitFor(() => expect(onDirtyChange).toHaveBeenCalledWith(false));
});

it("updates only planning status with the current day revision", async () => {
  renderPage();
  await screen.findByText(/虚构路 100 号/);

  fireEvent.change(screen.getByRole("combobox", { name: "任务状态" }), {
    target: { value: "ready" },
  });

  await waitFor(() =>
    expect(apiMocks.updatePlanTaskStatus).toHaveBeenCalledWith(1, {
      expected_revision: revisionA,
      task_status: "ready",
    }),
  );
});

it("locks schedule and status controls when execution history exists", async () => {
  const lockedTask = { ...tasks[0], status: "in_progress" as const, has_execution_history: true };
  apiMocks.getDayPlan.mockResolvedValue({
    ...dayPlan,
    schedule_locked: true,
    tasks: [lockedTask],
    task_count: 1,
  });
  apiMocks.getPlanTask.mockResolvedValue({
    ...detailFor(lockedTask),
    task: lockedTask,
  });
  renderPage();

  expect(await screen.findByText("当天已有执行记录，时间与顺序已锁定。")).toBeInTheDocument();
  expect(screen.getByLabelText("任务 #1 计划时间")).toBeDisabled();
  expect(screen.getByRole("button", { name: "保存排程" })).toBeDisabled();
  expect(await screen.findByRole("combobox", { name: "任务状态" })).toBeDisabled();
});

it("previews real route metrics and adopts the revision-protected recommendation", async () => {
  renderPage();
  await screen.findByRole("button", { name: "规划当天路线" });

  fireEvent.click(screen.getByRole("button", { name: "规划当天路线" }));
  await waitFor(() => expect(apiMocks.previewPlanRoute).toHaveBeenCalledWith(
    "2034-10-01",
    { expected_revision: revisionA, geocode_missing: true },
  ));
  expect(await screen.findByText("12.6 km → 9.8 km")).toBeInTheDocument();
  expect(screen.getByText("9.8 km · 37 分钟")).toBeInTheDocument();
  expect(screen.getByText("家 → P4 第三位虚构客户 → P4 第二位虚构客户 → P4 第一位虚构客户 → 家")).toBeInTheDocument();

  expect(screen.getByRole("button", { name: "订单 #103，P4 第三位虚构客户，路线第 1 站" })).toHaveTextContent("#103");
  fireEvent.click(screen.getByRole("button", { name: "采用优化顺序" }));

  await waitFor(() => expect(apiMocks.saveDaySchedule).toHaveBeenCalledWith(
    "2034-10-01",
    {
      expected_revision: revisionB,
      tasks: [
        { task_id: 3, planned_time: null },
        { task_id: 2, planned_time: null },
        { task_id: 1, planned_time: "09:30" },
      ],
    },
  ));
  expect((await screen.findAllByText("P4 第三位虚构客户")).length).toBeGreaterThan(0);
});

it("keeps the optimized order and omits road metrics when AMap degrades", async () => {
  apiMocks.previewPlanRoute.mockResolvedValue({
    ...previewWorkspace,
    road_route: {
      status: "degraded",
      path: null,
      message: "顺序已完成本地规划；真实电动车道路暂不可用：高德服务端繁忙",
    },
  });
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "规划当天路线" }));

  expect(
    await screen.findByText(/真实电动车道路暂不可用：高德服务端繁忙/),
  ).toBeInTheDocument();
  expect(screen.queryByText("9.8 km · 37 分钟")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "采用优化顺序" })).toBeInTheDocument();
});

it("keeps manual scheduling available when the map provider is not configured", async () => {
  apiMocks.getPlanRoute.mockResolvedValue({
    ...routeWorkspace,
    provider: {
      name: "disabled",
      configured: false,
      coordinate_system: "unknown",
      message: "地图服务尚未配置；请参考 .env.example 启用高德 Adapter",
    },
    start: null,
    markers: [],
    unresolved_tasks: routeWorkspace.markers.map((marker) => ({
      task_id: marker.task_id,
      customer_name: marker.customer_name,
      community: marker.community,
      address: marker.address,
      reason: "not_geocoded" as const,
    })),
  });
  renderPage();

  expect(await screen.findByText(/请参考 .env.example/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "规划当天路线" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "保存排程" })).toBeInTheDocument();
  expect(apiMocks.previewPlanRoute).not.toHaveBeenCalled();
});
