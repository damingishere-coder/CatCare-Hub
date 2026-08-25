export type OrderStatus =
  | "pending_confirmation"
  | "confirmed"
  | "in_progress"
  | "completed"
  | "cancelled";

export type OrderPaymentStatus = "unpaid" | "partial" | "paid" | "refunded";
export type OrderSettlementMode = "daily" | "order_total";
export type OrderAdjustmentType = "none" | "surcharge" | "discount";

export interface OrderAmountAdjustment {
  type: OrderAdjustmentType;
  amount: string;
  reason: string | null;
  service_date: string | null;
}

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
  id: number | null;
  name: string;
  community: string | null;
  address: string | null;
}

export interface OrderCatSummary {
  id: number | null;
  name: string;
  is_active: boolean;
}

export interface OrderServiceContact {
  name: string;
  wechat_name: string | null;
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
  notes: string | null;
  is_repeat_customer: boolean;
  latitude: string | null;
  longitude: string | null;
  geocode_status: string | null;
}

export interface OrderCatSnapshot {
  source_cat_id: number | null;
  name: string;
  photo_url: string | null;
  gender: string | null;
  age: string | null;
  breed: string | null;
  personality: string | null;
  food: string | null;
  food_preference: string | null;
  litter_type: string | null;
  medication_required: boolean;
  medication_notes: string | null;
  special_notes: string | null;
  service_notes: string | null;
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
  source_customer_id: number | null;
  service_contact: OrderServiceContact;
  cat_snapshot: OrderCatSnapshot[];
  customer: OrderCustomerSummary;
  cats: OrderCatSummary[];
  start_date: string;
  end_date: string;
  visits_per_day: number;
  service_days: number;
  total_visits: number;
  cat_count: number;
  service_schedule: Array<{ service_date: string; visit_count: number }>;
  service_items: ServiceItem[];
  pricing_mode: "legacy_components" | "per_visit";
  settlement_mode: OrderSettlementMode;
  amount_adjustment: OrderAmountAdjustment;
  unit_price: string;
  base_price: string;
  extra_cat_fee: string;
  stairs_fee: string;
  other_fee: string;
  total_amount: string;
  paid_amount: string;
  due_amount: string;
  overpaid_amount: string;
  payment_status: OrderPaymentStatus;
  financial_revision: string;
  has_payment_history: boolean;
  daily_receivables: Array<{
    service_date: string;
    expected_amount: string;
    paid_amount: string;
    due_amount: string;
    overpaid_amount: string;
    task_status: TaskStatus | null;
  }>;
  order_status: OrderStatus;
  route_geocode_status: string | null;
  pending_cat_profile_count: number;
  customer_resolution: string | null;
  is_demo_data: boolean;
  task_count: number;
  deletable: boolean;
  delete_block_reason: string | null;
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

export interface OrderCatOption extends Omit<OrderCatSnapshot, "source_cat_id"> {
  id: number;
}

export interface OrderCustomerOption {
  id: number;
  name: string;
  wechat_name: string | null;
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
  notes: string | null;
  is_repeat_customer: boolean;
  latitude: string | null;
  longitude: string | null;
  geocode_status: string | null;
  cats: OrderCatOption[];
}

export interface OrderFormOptions {
  customers: OrderCustomerOption[];
  default_base_price: string;
  extra_cat_unit_price: string;
  stairs_unit_price: string;
}

export interface OrderCreateInput {
  source_customer_id?: number;
  service_contact: OrderServiceContact;
  cat_snapshot: OrderCatSnapshot[];
  cat_count: number;
  service_dates: string[];
  service_items: ServiceItem[];
  unit_price: string;
  settlement_mode: OrderSettlementMode;
  amount_adjustment: OrderAmountAdjustment;
  notes: string | null;
}

export interface OrderPatchInput {
  source_customer_id?: number | null;
  service_contact?: OrderServiceContact;
  cat_snapshot?: OrderCatSnapshot[];
  cat_count?: number;
  service_dates?: string[];
  service_items?: ServiceItem[];
  unit_price?: string;
  settlement_mode?: OrderSettlementMode;
  amount_adjustment?: OrderAmountAdjustment;
  notes?: string | null;
  expected_financial_revision?: string;
}

export type OrderSaveInput = OrderCreateInput | OrderPatchInput;
export type OrderInput = OrderCreateInput;
