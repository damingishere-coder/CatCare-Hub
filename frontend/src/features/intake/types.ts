export type FormTokenStatus = "active" | "disabled" | "expired";
export type FormSubmissionStatus = "draft" | "submitted" | "reviewed" | "converted" | "expired";
export type PublicIntakeState = "editable" | "submitted" | "reviewed" | "converted";
export type TaskItemType =
  | "feed"
  | "water"
  | "litter"
  | "canned_food"
  | "medicine"
  | "play"
  | "photo"
  | "other";

export interface IntakeCustomerDraft {
  name: string | null;
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
}

export interface IntakeCatDraft {
  name: string | null;
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

export interface IntakeServiceDraft {
  start_date: string | null;
  end_date: string | null;
  visits_per_day: number | null;
  service_items: TaskItemType[];
}

export interface IntakeDraftPayload {
  customer: IntakeCustomerDraft;
  cats: IntakeCatDraft[];
  service: IntakeServiceDraft;
  notes: string | null;
}

export interface PublicIntakeRead {
  status: PublicIntakeState;
  expires_at: string;
  draft: IntakeDraftPayload | null;
}

export interface IntakeTokenRead {
  id: number;
  status: FormTokenStatus;
  expires_at: string | null;
  submitted_at: string | null;
  fill_path: string | null;
  submission_status: FormSubmissionStatus | null;
  revision: string;
  created_at: string;
}

export interface IntakeTokenList {
  items: IntakeTokenRead[];
  total: number;
}

export interface IntakeSubmissionSummary {
  id: number;
  status: FormSubmissionStatus;
  customer_name: string | null;
  community: string | null;
  cat_count: number;
  start_date: string | null;
  end_date: string | null;
  submitted_at: string | null;
  updated_at: string;
  revision: string;
}

export interface IntakeSubmissionList {
  items: IntakeSubmissionSummary[];
  total: number;
}

export interface IntakeSubmissionDetail extends IntakeSubmissionSummary {
  payload: IntakeDraftPayload;
  reviewed_at: string | null;
  converted_at: string | null;
  converted_customer_id: number | null;
  converted_order_id: number | null;
}

export interface IntakeConversionRead {
  submission_id: number;
  status: "converted";
  customer_id: number;
  order_id: number;
  revision: string;
}
