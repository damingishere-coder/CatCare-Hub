import type {
  OrderPaymentStatus,
  OrderStatus,
  ServiceItem,
  TaskStatus,
} from "../orders/types";

export type PlanTaskStatus = TaskStatus;

export interface PlanCustomerSummary {
  id: number | null;
  name: string;
  community: string | null;
  address: string | null;
}

export interface PlanCustomerDetail extends PlanCustomerSummary {
  building: string | null;
  unit: string | null;
  room: string | null;
}

export interface PlanCatSummary {
  id: number | null;
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
  cat_count: number;
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

export interface PlanGeoPoint {
  latitude: number;
  longitude: number;
}

export interface PlanMapProvider {
  name: string;
  configured: boolean;
  coordinate_system: string;
  message: string | null;
}

export interface PlanRecommendationProvider {
  name: string;
  configured: boolean;
  message: string | null;
}

export interface PlanRouteStart {
  label: string;
  position: PlanGeoPoint;
}

export interface PlanRouteMarker {
  task_id: number;
  sequence: number;
  customer_name: string;
  community: string | null;
  address: string | null;
  position: PlanGeoPoint;
  navigation_url: string | null;
}

export type PlanRouteIssueReason =
  | "missing_address"
  | "not_geocoded"
  | "geocode_failed"
  | "execution_location_missing";

export interface PlanRouteIssue {
  task_id: number;
  customer_name: string;
  community: string | null;
  address: string | null;
  reason: PlanRouteIssueReason;
}

export interface PlanRoutePath {
  task_ids: number[];
  distance_meters: number;
  duration_seconds: number;
  polyline: PlanGeoPoint[];
}

export interface PlanRouteWorkspace {
  service_date: string;
  revision: string;
  schedule_locked: boolean;
  transport_mode: "electrobike" | "unknown";
  provider: PlanMapProvider;
  recommendation_provider: PlanRecommendationProvider;
  start: PlanRouteStart | null;
  markers: PlanRouteMarker[];
  unresolved_tasks: PlanRouteIssue[];
  current_route: PlanRoutePath | null;
  recommended_route: PlanRoutePath | null;
  recommended_task_ids: number[];
  recommendation_source: "none" | "openai" | "local";
  recommendation_message: string | null;
  can_adopt_recommendation: boolean;
}

export interface PlanRoutePreviewInput {
  expected_revision: string;
  geocode_missing: boolean;
}
