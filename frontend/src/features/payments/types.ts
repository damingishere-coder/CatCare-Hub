import type { OrderPaymentStatus, OrderSettlementMode, OrderStatus, TaskStatus } from "../orders/types";

export type PaymentMethod = "wechat" | "alipay" | "cash" | "other";
export type PaymentRecordStatus = "pending" | "completed" | "refunded" | "voided";

export interface PaymentMetrics {
  today_income: string;
  pending_order_count: number;
  month_income: string;
  completed_order_count: number;
}

export interface PaymentReceivable {
  order_id: number;
  settlement_mode: OrderSettlementMode;
  service_date: string | null;
  customer_name: string;
  community: string | null;
  address: string | null;
  start_date: string;
  end_date: string;
  cat_count: number;
  total_amount: string;
  paid_amount: string;
  due_amount: string;
  overpaid_amount: string;
  payment_status: OrderPaymentStatus;
  order_status: OrderStatus;
  task_status: TaskStatus | null;
  revision: string;
}

export interface PaymentRecord {
  id: number;
  order_id: number;
  service_date: string | null;
  customer_name: string;
  start_date: string;
  end_date: string;
  cat_count: number;
  amount: string;
  payment_method: PaymentMethod;
  payment_status: PaymentRecordStatus;
  paid_at: string | null;
  voided_at: string | null;
  voided_reason: string | null;
  revision: string;
}

export interface PaymentsOverview {
  business_date: string;
  month_start: string;
  metrics: PaymentMetrics;
  receivables: PaymentReceivable[];
  records: PaymentRecord[];
}

export interface PaymentCreateInput {
  order_id: number;
  service_date: string | null;
  amount: string;
  payment_method: PaymentMethod;
  paid_at: string;
  notes: string | null;
  expected_revision: string;
}

export interface PaymentRegistration {
  payment: PaymentRecord;
  order: PaymentReceivable;
}

export interface PaymentVoidInput {
  expected_revision: string;
  reason: string;
}

export interface PaymentVoidResult {
  payment: PaymentRecord;
  order_id: number;
  paid_amount: string;
  due_amount: string;
  overpaid_amount: string;
  payment_status: OrderPaymentStatus;
  revision: string;
}
