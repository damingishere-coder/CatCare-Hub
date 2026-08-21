import type { ServiceItem } from "./types";

export const serviceItemOptions: ReadonlyArray<{ value: ServiceItem; label: string }> = [
  { value: "feed", label: "添粮" },
  { value: "water", label: "换水" },
  { value: "litter", label: "清理猫砂" },
  { value: "canned_food", label: "喂罐头" },
  { value: "medicine", label: "喂药" },
  { value: "play", label: "陪玩" },
  { value: "photo", label: "拍照" },
  { value: "other", label: "其他" },
] as const;
