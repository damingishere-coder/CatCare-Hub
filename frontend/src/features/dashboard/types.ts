import type { TaskStatus } from "../orders/types";

export type DashboardReminderType =
  | "key_pickup"
  | "medicine"
  | "photos_pending"
  | "payment_due"
  | "last_service"
  | "order_starts_tomorrow";

export interface DashboardMetrics {
  month_order_count: number;
  pending_task_count: number;
  pending_payment_count: number;
  month_income: string;
}

export interface DashboardTaskSummary {
  id: number;
  order_id: number;
  order_number?: number;
  planned_time: string | null;
  sort_order: number;
  status: TaskStatus;
  customer_name: string;
  community: string | null;
  address: string | null;
  cat_count: number;
}

export interface DashboardReminder {
  id: string;
  kind: DashboardReminderType;
  customer_name: string;
  message: string;
  task_id: number | null;
  order_id: number | null;
  order_number?: number | null;
  cat_count: number | null;
  amount: string | null;
  expected_revision: string | null;
}

export interface DashboardResponse {
  business_date: string;
  month_start: string;
  metrics: DashboardMetrics;
  schedule: DashboardTaskSummary[];
  reminders: DashboardReminder[];
}

export interface DashboardPhotoSent {
  task_id: number;
  photos_sent_at: string;
  revision: string;
}
