import type {
  IntakeCatDraft,
  IntakeCustomerDraft,
  IntakeDraftPayload,
  PublicIntakeCatDraft,
  PublicIntakeDraftPayload,
  TaskItemType,
} from "./types";

export const serviceItemOptions: Array<{ value: TaskItemType; label: string }> = [
  { value: "feed", label: "添粮 / 喂食" },
  { value: "water", label: "换水" },
  { value: "litter", label: "清理猫砂" },
  { value: "canned_food", label: "喂罐头" },
  { value: "medicine", label: "喂药" },
  { value: "play", label: "陪玩" },
  { value: "photo", label: "拍照反馈" },
  { value: "other", label: "其他事项" },
];

export const emptyCustomer: IntakeCustomerDraft = {
  name: null,
  is_repeat_customer: false,
  wechat_name: null,
  phone: null,
  community: null,
  address: null,
  building: null,
  unit: null,
  room: null,
  access_method: null,
  access_info: null,
  key_status: null,
  key_code: null,
  notes: null,
};

export const emptyCat = (): IntakeCatDraft => ({
  name: null,
  gender: null,
  age: null,
  breed: null,
  personality: null,
  food: null,
  food_preference: null,
  litter_type: null,
  medication_required: false,
  medication_notes: null,
  special_notes: null,
  service_notes: null,
});

export function editableDraft(draft: IntakeDraftPayload | null): IntakeDraftPayload {
  if (!draft) {
    return {
      customer: { ...emptyCustomer },
      cats: [emptyCat()],
      service: {
        start_date: null,
        end_date: null,
        visits_per_day: 1,
        service_items: ["feed", "water", "litter", "photo"],
      },
      notes: null,
    };
  }
  return {
    ...draft,
    customer: { ...emptyCustomer, ...draft.customer },
    cats: draft.cats.length ? draft.cats : [emptyCat()],
    service: {
      ...draft.service,
      visits_per_day: draft.service.visits_per_day ?? 1,
      service_items: draft.service.service_items.length
        ? draft.service.service_items
        : ["feed", "water", "litter", "photo"],
    },
  };
}

export const emptyPublicCat = (): PublicIntakeCatDraft => ({
  name: null,
  special_notes: null,
});

export function publicEditableDraft(
  draft: PublicIntakeDraftPayload | null,
): PublicIntakeDraftPayload {
  if (draft) return draft;
  return {
    customer: {
      name: null,
      wechat_name: null,
      phone: null,
      address: null,
      access_method: null,
      community_access_method: null,
      building_access_method: null,
      key_status: null,
      notes: null,
    },
    cats: [],
    service: {
      start_date: null,
      end_date: null,
      visits_per_day: null,
    },
    notes: null,
  };
}
