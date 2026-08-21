import type { PlanTaskStatus } from "./types";

export const planTaskStatusLabels: Record<PlanTaskStatus, string> = {
  pending: "待确认",
  confirmed: "已确认",
  ready: "待出发",
  in_progress: "进行中",
  completed: "已完成",
  exception: "异常",
  cancelled: "已取消",
};

export const editablePlanStatuses: PlanTaskStatus[] = [
  "pending",
  "confirmed",
  "ready",
  "cancelled",
];
