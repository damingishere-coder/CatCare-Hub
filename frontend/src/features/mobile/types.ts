import type { TaskStatus } from "../orders/types";
import type { TaskExecutionDetail } from "../tasks/types";

export type NavigationState =
  | "ready"
  | "missing_coordinates"
  | "provider_unavailable";

export interface MobileTodayTask {
  id: number;
  order_id: number;
  sequence: number;
  sort_order: number;
  planned_time: string | null;
  status: TaskStatus;
  customer_name: string;
  community: string | null;
  address: string | null;
  cat_count: number;
  navigation_url: string | null;
  navigation_state: NavigationState;
}

export interface MobileTodayRead {
  business_date: string;
  task_count: number;
  open_task_count: number;
  completed_task_count: number;
  tasks: MobileTodayTask[];
}

export interface MobileTaskExecutionDetail extends TaskExecutionDetail {
  navigation_url: string | null;
  navigation_state: NavigationState;
}
