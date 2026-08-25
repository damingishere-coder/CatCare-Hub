export interface ParsedOrderAddress {
  community: string | null;
  address: string | null;
  building: string | null;
  unit: string | null;
  room: string | null;
  recognizedParts: number;
}

const DEFAULT_CITY = "深圳市";
const DEFAULT_DISTRICT = "龙岗区";

function explicitCity(value: string): string | null {
  const match = /(?:^|省|\s)([^省区县乡镇街道路\s]{2,8}市)/u.exec(value);
  return match?.[1] ?? null;
}

function explicitDistrict(value: string): string | null {
  const matches = value.matchAll(/(?:^|省|市|\s)([^省市\s]{1,8}(?:区|县))/gu);
  for (const match of matches) {
    const candidate = match[1];
    if (candidate && !candidate.endsWith("小区") && !candidate.endsWith("社区")) {
      return candidate;
    }
  }
  return null;
}

export function applyDefaultServiceArea(value: string): string {
  const city = explicitCity(value);
  const district = explicitDistrict(value);
  if (city && district) return value;
  if (city) {
    return city === DEFAULT_CITY
      ? value.replace(DEFAULT_CITY, `${DEFAULT_CITY}${DEFAULT_DISTRICT}`)
      : value;
  }
  if (district) {
    return district === DEFAULT_DISTRICT
      ? value.replace(DEFAULT_DISTRICT, `${DEFAULT_CITY}${DEFAULT_DISTRICT}`)
      : value;
  }
  return `${DEFAULT_CITY}${DEFAULT_DISTRICT}${value}`;
}

function toHalfWidth(value: string): string {
  return [...value].map((character) => {
    const code = character.charCodeAt(0);
    if (code === 0x3000) return " ";
    if (code >= 0xff01 && code <= 0xff5e) {
      return String.fromCharCode(code - 0xfee0);
    }
    return character;
  }).join("");
}

export function normalizePastedAddress(value: string): string {
  return toHalfWidth(value)
    .replace(/[\r\n\t,，;；|｜]+/g, " ")
    .replace(/(?:收货地址|详细地址|地址)\s*[:：]?/g, " ")
    .replace(/(?:联系电话|手机号码|手机号|手机|电话)\s*[:：]?\s*1\d{10}/g, " ")
    .replace(/\b1\d{10}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactPart(value: string): string {
  return value.replace(/\s+/g, "");
}

function extractPart(
  input: string,
  pattern: RegExp,
): { value: string | null; remaining: string } {
  const match = pattern.exec(input);
  if (!match?.[1]) return { value: null, remaining: input };
  return {
    value: compactPart(match[1]),
    remaining: `${input.slice(0, match.index)} ${input.slice(match.index + match[0].length)}`
      .replace(/\s+/g, " ")
      .trim(),
  };
}

function extractCommunity(input: string): { value: string | null; remaining: string } {
  const tokens = input.split(/\s+/).filter(Boolean);
  const candidate = tokens.find((token) => (
    token.length >= 3
    && token.length <= 24
    && /(?:小区|花园|公寓|华庭|家园|苑|府|湾|里|大厦)$/u.test(token)
    && !/(?:省|市|区|县|街道|大道|公路|路|街)/u.test(token)
  ));
  if (candidate) {
    const index = tokens.indexOf(candidate);
    tokens.splice(index, 1);
    return { value: candidate, remaining: tokens.join(" ") };
  }

  const compact = compactPart(input);
  const contiguous = /([^省市区县乡镇街道路号\s]{2,20}(?:小区|花园|公寓|华庭|家园|苑|府|湾|里|大厦))$/u.exec(compact);
  if (!contiguous?.[1]) return { value: null, remaining: input };
  return {
    value: contiguous[1],
    remaining: compact.slice(0, contiguous.index).trim(),
  };
}

export function parseOrderAddress(value: string): ParsedOrderAddress {
  const rawNormalized = normalizePastedAddress(value);
  const normalized = rawNormalized ? applyDefaultServiceArea(rawNormalized) : "";
  if (!normalized) {
    return {
      community: null,
      address: null,
      building: null,
      unit: null,
      room: null,
      recognizedParts: 0,
    };
  }

  let remaining = normalized;
  const roomResult = extractPart(
    remaining,
    /((?:地下)?(?:[A-Za-z]\d{1,5}|\d{1,5}|[一二三四五六七八九十百]+)\s*(?:室|房|户))/u,
  );
  remaining = roomResult.remaining;
  const unitResult = extractPart(
    remaining,
    /((?:[A-Za-z]|\d{1,3}|[一二三四五六七八九十百]+)\s*(?:单元|门|梯))/u,
  );
  remaining = unitResult.remaining;
  const buildingResult = extractPart(
    remaining,
    /((?:地下)?(?:[A-Za-z]|\d{1,3}|[一二三四五六七八九十百]+)\s*(?:号楼|栋|幢|座))/u,
  );
  remaining = buildingResult.remaining;
  const communityResult = extractCommunity(remaining);
  remaining = communityResult.remaining.replace(/^[\s:：-]+|[\s:：-]+$/g, "").trim();

  const structuralParts = [
    communityResult.value,
    buildingResult.value,
    unitResult.value,
    roomResult.value,
  ].filter(Boolean).length;
  return {
    community: communityResult.value,
    address: remaining || (structuralParts === 0 ? normalized : null),
    building: buildingResult.value,
    unit: unitResult.value,
    room: roomResult.value,
    recognizedParts: structuralParts,
  };
}
