import type {
  OrderPaymentStatus,
  OrderStatus,
  ServiceItem,
  TaskStatus,
} from "../orders/types";

export type PlanTaskStatus = TaskStatus;

export interface PlanCustomerSummary {
  id: number;
  name: string;
  community: string | null;
}

export interface PlanCustomerDetail extends PlanCustomerSummary {
  address: string | null;
  building: string | null;
  unit: string | null;
  room: string | null;
}

export interface PlanCatSummary {
  id: number;
  name: string;
}

export interface PlanCatDetail extends PlanCatSummary {
  is_active: boolean;
  medication_required: boolean;
  medication_notes: string | null;
  special_notes: string | null;
  service_notes: string | null;
}

export interface PlanTaskItem {
  item_type: ServiceItem;
  required: boolean;
  completed: boolean;
}

export interface PlanTaskSummary {
  id: number;
  order_id: number;
  service_date: string;
  planned_time: string | null;
  sort_order: number;
  status: PlanTaskStatus;
  customer: PlanCustomerSummary;
  cats: PlanCatSummary[];
  items: PlanTaskItem[];
  has_execution_history: boolean;
}

export interface PlanDaySummary {
  service_date: string;
  task_count: number;
  order_count: number;
  cat_count: number;
}

export interface PlanDaysResponse {
  items: PlanDaySummary[];
  total: number;
}

export interface DayPlan {
  service_date: string;
  task_count: number;
  order_count: number;
  cat_count: number;
  revision: string;
  schedule_locked: boolean;
  tasks: PlanTaskSummary[];
}

export interface PlanTaskDetail {
  task: PlanTaskSummary;
  day_revision: string;
  customer: PlanCustomerDetail;
  cats: PlanCatDetail[];
  order_status: OrderStatus;
  payment_status: OrderPaymentStatus;
  order_notes: string | null;
  task_notes: string | null;
  estimated_arrival: string | null;
  photo_count: number;
}

export interface PlanScheduleInput {
  expected_revision: string;
  tasks: Array<{
    task_id: number;
    planned_time: string | null;
  }>;
}

export interface PlanTaskStatusInput {
  expected_revision: string;
  task_status: PlanTaskStatus;
}
