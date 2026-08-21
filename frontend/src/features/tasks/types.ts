import type { OrderStatus, ServiceItem, TaskStatus } from "../orders/types";

export interface TaskExecutionCustomer {
  id: number;
  name: string;
  phone: string | null;
  community: string | null;
  address: string | null;
  building: string | null;
  unit: string | null;
  room: string | null;
  access_method: string | null;
  access_info: string | null;
  key_status: string | null;
  key_code: string | null;
}

export interface TaskExecutionCat {
  id: number;
  name: string;
  food: string | null;
  food_preference: string | null;
  litter_type: string | null;
  medication_required: boolean;
  medication_notes: string | null;
  special_notes: string | null;
  service_notes: string | null;
  is_active: boolean;
}

export interface TaskExecutionItem {
  id: number;
  item_type: ServiceItem;
  required: boolean;
  completed: boolean;
}

export interface TaskExecutionPhoto {
  id: number;
  url: string;
  created_at: string;
}

export interface TaskExecutionDetail {
  id: number;
  order_id: number;
  service_date: string;
  planned_time: string | null;
  status: TaskStatus;
  started_at: string | null;
  completed_at: string | null;
  photos_sent_at: string | null;
  notes: string | null;
  cat_status: string | null;
  exception_notes: string | null;
  revision: string;
  order_status: OrderStatus;
  order_notes: string | null;
  customer: TaskExecutionCustomer;
  cats: TaskExecutionCat[];
  items: TaskExecutionItem[];
  photos: TaskExecutionPhoto[];
}

export interface TaskRevisionInput {
  expected_revision: string;
}

export interface TaskChecklistInput extends TaskRevisionInput {
  completed: boolean;
}

export interface TaskTextInput extends TaskRevisionInput {
  notes: string | null;
  cat_status: string | null;
}

export interface TaskExceptionInput extends TaskRevisionInput {
  exception_notes: string;
}
