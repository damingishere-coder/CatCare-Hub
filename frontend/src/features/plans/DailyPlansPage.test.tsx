import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DailyPlansPage } from "./DailyPlansPage";
import type { DayPlan, PlanTaskDetail, PlanTaskSummary } from "./types";

const apiMocks = vi.hoisted(() => ({
  getPlanDays: vi.fn(),
  getDayPlan: vi.fn(),
  getPlanTask: vi.fn(),
  saveDaySchedule: vi.fn(),
  updatePlanTaskStatus: vi.fn(),
}));

vi.mock("./api", () => apiMocks);

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
    service_date: "2034-10-01",
    planned_time: id === 1 ? "09:30:00" : null,
    sort_order: sortOrder,
    status: "confirmed",
    customer: { id, name: customerName, community: `虚构小区 ${id}` },
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
      },
    ],
    total: 1,
  });
  apiMocks.getDayPlan.mockResolvedValue(dayPlan);
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
  render(<DailyPlansPage onDirtyChange={vi.fn()} />);

  expect((await screen.findAllByText("P4 第一位虚构客户")).length).toBeGreaterThanOrEqual(2);
  expect(screen.getByRole("heading", { name: "路线地图" })).toBeInTheDocument();
  expect(screen.getByText(/真实坐标、路线、距离和预计路程将在 P5/)).toBeInTheDocument();
  expect(await screen.findByText(/虚构路 100 号/)).toBeInTheDocument();
  expect(screen.getByText("服务：虚构服务注意事项")).toBeInTheDocument();
  expect(screen.queryByText("000-PLAN-TEST")).not.toBeInTheDocument();
  expect(apiMocks.getDayPlan).toHaveBeenCalledWith("2034-10-01");
  expect(apiMocks.getPlanTask).toHaveBeenCalledWith(1);
});

it("moves tasks, edits time, and saves one revision-protected day schedule", async () => {
  const onDirtyChange = vi.fn();
  render(<DailyPlansPage onDirtyChange={onDirtyChange} />);
  expect((await screen.findAllByText("P4 第二位虚构客户")).length).toBeGreaterThanOrEqual(2);

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
  render(<DailyPlansPage onDirtyChange={vi.fn()} />);
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
  render(<DailyPlansPage onDirtyChange={vi.fn()} />);

  expect(await screen.findByText("当天已有执行记录，时间与顺序已锁定。")).toBeInTheDocument();
  expect(screen.getByLabelText("任务 #1 计划时间")).toBeDisabled();
  expect(screen.getByRole("button", { name: "保存排程" })).toBeDisabled();
  expect(await screen.findByRole("combobox", { name: "任务状态" })).toBeDisabled();
});
