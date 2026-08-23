export const accessMethodOptions = [
  "密码",
  "门卡",
  "钥匙",
  "指纹或人脸",
  "联系物业",
  "无需门禁",
] as const;

export const keyStatusOptions = ["待取", "已取", "已归还", "无需钥匙"] as const;

export interface CustomerAddressParts {
  address?: string | null;
  community?: string | null;
  building?: string | null;
  unit?: string | null;
  room?: string | null;
}

export function customerAddress(value: CustomerAddressParts): string {
  const preferred = value.address?.trim();
  if (preferred) return preferred;
  return [value.community, value.building, value.unit, value.room]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .filter((part, index, parts) => parts.indexOf(part) === index)
    .join(" ");
}

export function optionsWithLegacy(
  options: readonly string[],
  current: string | null | undefined,
): readonly string[] {
  const normalized = current?.trim();
  return normalized && !options.includes(normalized) ? [normalized, ...options] : options;
}
