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
  updated_at?: string | null;
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
  customer_names: string[];
  orders?: Array<{
    order_id: number;
    customer_name: string;
    visit_count: number;
    order_status: OrderStatus;
  }>;
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
  order_updated_at?: string;
  route_geocode_status?: string | null;
  current_position?: PlanGeoPoint | null;
  location_scope?: "customer" | "order";
  location_sync_order_count?: number;
  location_sync_task_count?: number;
}

export interface LocationUpdateRead {
  scope: "customer" | "order";
  customer_id: number | null;
  order_id: number;
  original_position: PlanGeoPoint | null;
  position: PlanGeoPoint;
  affected_orders: number;
  affected_tasks: number;
  customer_updated_at: string | null;
  order_updated_at: string;
  day_revision: string;
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
  | "stale_geocode"
  | "geocode_mismatch"
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

export interface PlanRouteOptimization {
  method: "exact" | "two_opt" | "none";
  planned_time_policy: "precedence";
  baseline_task_ids: number[];
  optimized_task_ids: number[];
  baseline_estimated_distance_meters: number;
  optimized_estimated_distance_meters: number;
  estimated_savings_percent: number;
}

export interface PlanRoadRoute {
  status: "not_generated" | "ready" | "degraded";
  path: PlanRoutePath | null;
  message: string | null;
}

export interface PlanRouteWorkspace {
  service_date: string;
  revision: string;
  schedule_locked: boolean;
  transport_mode: "electrobike" | "unknown";
  provider: PlanMapProvider;
  route_mode: "round_trip";
  start: PlanRouteStart | null;
  markers: PlanRouteMarker[];
  unresolved_tasks: PlanRouteIssue[];
  optimization: PlanRouteOptimization | null;
  road_route: PlanRoadRoute;
  can_adopt_recommendation: boolean;
}

export interface PlanRoutePreviewInput {
  expected_revision: string;
  geocode_missing: boolean;
}
