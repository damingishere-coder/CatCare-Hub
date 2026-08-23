export interface CustomerSummary {
  id: number;
  name: string;
  wechat_name: string | null;
  phone: string | null;
  community: string | null;
  is_repeat_customer: boolean;
  active_cat_count: number;
  inactive_cat_count: number;
  pending_cat_profile_count: number;
  archived_at: string | null;
  updated_at: string;
}

export interface CatDetail {
  id: number;
  customer_id: number;
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
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomerDetail {
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
  cats: CatDetail[];
  pending_cat_profile_count: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomerListResponse {
  items: CustomerSummary[];
  total: number;
}

export interface CustomerInput {
  name: string;
  address: string | null;
  access_method: string | null;
  key_status: string | null;
  key_code: string | null;
  notes: string | null;
  is_repeat_customer: boolean;
}

export interface CatInput {
  name: string;
  photo_url: string | null;
  gender: string | null;
  age: number | null;
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
