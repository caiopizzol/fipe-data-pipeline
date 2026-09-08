import { InvalidArgumentError } from "commander";

export function parseInteger(value: string, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new InvalidArgumentError(
      `Expected an integer between ${min} and ${max}, received "${value}"`,
    );
  }
  return parsed;
}

export function parseNumberList(value: string, min: number, max: number): number[] {
  const numbers = new Set<number>();
  for (const part of value.split(",")) {
    const bounds = part.trim().split("-");
    if (bounds.length > 2) throw new InvalidArgumentError(`Invalid range "${part}"`);
    const start = parseInteger(bounds[0].trim(), min, max);
    const end = bounds.length === 2 ? parseInteger(bounds[1].trim(), min, max) : start;
    if (end < start) throw new InvalidArgumentError(`Range must be ascending: "${part}"`);
    for (let current = start; current <= end; current++) numbers.add(current);
  }
  return [...numbers].sort((a, b) => a - b);
}

export function parseCodes(value: string): string[] {
  return [...new Set(value.split(",").map((part) => String(parseInteger(part.trim()))))];
}
