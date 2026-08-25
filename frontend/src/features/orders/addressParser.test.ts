import { describe, expect, it } from "vitest";

import { normalizePastedAddress, parseOrderAddress } from "./addressParser";

describe("parseOrderAddress", () => {
  it("parses a common residential address into existing order fields", () => {
    expect(parseOrderAddress("广东省深圳市龙华区民治街道 星河盛世花园 3栋 2单元 1201室")).toEqual({
      community: "星河盛世花园",
      address: "广东省深圳市龙华区民治街道",
      building: "3栋",
      unit: "2单元",
      room: "1201室",
      recognizedParts: 4,
    });
  });

  it("normalizes full-width text and alternate building markers", () => {
    expect(parseOrderAddress("深圳市南山区 科技园公寓 Ａ座；３门；８０２房")).toMatchObject({
      community: "科技园公寓",
      address: "深圳市南山区",
      building: "A座",
      unit: "3门",
      room: "802房",
    });
  });

  it("parses a common address pasted without spaces", () => {
    expect(parseOrderAddress("广东省深圳市龙华区民治街道星河盛世花园3号楼2单元1201室")).toMatchObject({
      community: "星河盛世花园",
      address: "广东省深圳市龙华区民治街道",
      building: "3号楼",
      unit: "2单元",
      room: "1201室",
    });
  });

  it("keeps uncertain text in the detailed address instead of guessing", () => {
    expect(parseOrderAddress("深圳市福田区深南大道100号附近右转")).toEqual({
      community: null,
      address: "深圳市福田区深南大道100号附近右转",
      building: null,
      unit: null,
      room: null,
      recognizedParts: 0,
    });
  });

  it("removes a labeled phone number without returning contact fields", () => {
    expect(normalizePastedAddress("电话：13800138000，地址：深圳市罗湖区 春风家园 2幢 501户"))
      .toBe("深圳市罗湖区 春风家园 2幢 501户");
  });
});
