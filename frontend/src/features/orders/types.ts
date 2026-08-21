export type OrderStatus =
  | "pending_confirmation"
  | "confirmed"
  | "in_progress"
  | "completed"
  | "cancelled";

export type OrderPaymentStatus = "unpaid" | "partial" | "paid" | "refunded";

export type TaskStatus =
  | "pending"
  | "confirmed"
  | "ready"
  | "in_progress"
  | "completed"
  | "exception"
  | "cancelled";

export type ServiceItem =
  | "feed"
  | "water"
  | "litter"
  | "canned_food"
  | "medicine"
  | "play"
  | "photo"
  | "other";

export interface OrderCustomerSummary {
  id: number;
  name: string;
  community: string | null;
}

export interface OrderCatSummary {
  id: number;
  name: string;
  is_active: boolean;
}

export interface OrderTaskItem {
  item_type: ServiceItem;
  required: boolean;
  completed: boolean;
}

export interface OrderTask {
  id: number;
  service_date: string;
  planned_time: string | null;
  sort_order: number;
  status: TaskStatus;
  items: OrderTaskItem[];
}

export interface OrderSummary {
  id: number;
  customer: OrderCustomerSummary;
  cats: OrderCatSummary[];
  start_date: string;
  end_date: string;
  visits_per_day: number;
  service_days: number;
  total_visits: number;
  service_items: ServiceItem[];
  base_price: string;
  extra_cat_fee: string;
  stairs_fee: string;
  other_fee: string;
  total_amount: string;
  paid_amount: string;
  due_amount: string;
  payment_status: OrderPaymentStatus;
  order_status: OrderStatus;
  task_count: number;
  updated_at: string;
}

export interface OrderDetail extends OrderSummary {
  notes: string | null;
  tasks: OrderTask[];
  created_at: string;
}

export interface OrderListResponse {
  items: OrderSummary[];
  total: number;
}

export interface OrderCatOption {
  id: number;
  name: string;
}

export interface OrderCustomerOption {
  id: number;
  name: string;
  community: string | null;
  cats: OrderCatOption[];
}

export interface OrderFormOptions {
  customers: OrderCustomerOption[];
  default_base_price: string;
  extra_cat_unit_price: string;
  stairs_unit_price: string;
}

export interface OrderInput {
  customer_id: number;
  cat_ids: number[];
  start_date: string;
  end_date: string;
  visits_per_day: number;
  service_items: ServiceItem[];
  base_price: string;
  stairs_fee: string;
  other_fee: string;
  order_status: OrderStatus;
  notes: string | null;
}
