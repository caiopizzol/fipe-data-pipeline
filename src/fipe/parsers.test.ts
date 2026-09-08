import { expect, test } from "vite-plus/test";
import { parsePrice, parseReferenceMonth, parseYearValue } from "./parsers.js";

test("parses Brazilian FIPE values without floating point conversion", () => {
  expect(parsePrice("R$ 4.147,00")).toBe("4147.00");
  expect(parsePrice("R$ 100000,99")).toBe("100000.99");
  expect(parseReferenceMonth("dezembro/2025 ")).toEqual({ month: 12, year: 2025 });
  expect(parseReferenceMonth("Março/2024")).toEqual({ month: 3, year: 2024 });
  expect(parseYearValue("32000-1")).toEqual({ year: 32000, fuelCode: 1 });
});
test("rejects invalid upstream values rather than storing invalid numbers", () => {
  expect(() => parseReferenceMonth("unknown/2025")).toThrow();
  expect(() => parseReferenceMonth("janeiro/2025junk")).toThrow();
  expect(() => parsePrice("R$ 1.20,00")).toThrow();
  expect(() => parseYearValue("2024-NaN")).toThrow();
});
