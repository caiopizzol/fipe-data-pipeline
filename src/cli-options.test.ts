import { describe, expect, test } from "vite-plus/test";
import { parseCodes, parseInteger, parseNumberList } from "./cli-options.js";

describe("CLI values", () => {
  test("accepts ranges and lists without duplicates", () => {
    expect(parseNumberList("2020-2022, 2021,2024", 2001, 9999)).toEqual([2020, 2021, 2022, 2024]);
    expect(parseCodes("59,21,59")).toEqual(["59", "21"]);
  });
  test.each(["2024garbage", "", "2025-2024", "2020-2021-2022", "NaN", "2024,"])(
    "rejects invalid year %s",
    (value) => {
      expect(() => parseNumberList(value, 2001, 9999)).toThrow();
    },
  );
  test("rejects invalid months and identifiers", () => {
    expect(() => parseNumberList("13", 1, 12)).toThrow();
    expect(() => parseInteger("bad")).toThrow();
    expect(() => parseCodes(",")).toThrow();
  });
});
