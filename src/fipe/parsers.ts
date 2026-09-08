export function parseYearValue(value: string): { year: number; fuelCode: number } {
  const match = /^(\d{4}|32000)-([123])$/.exec(value);
  if (!match) throw new Error(`Invalid FIPE model-year: "${value}"`);
  return { year: Number(match[1]), fuelCode: Number(match[2]) };
}

export function parsePrice(valor: string): string {
  if (!/^R\$\s+(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}$/.test(valor)) {
    throw new Error(`Invalid FIPE price: "${valor}"`);
  }
  return valor
    .replace(/^R\$\s+/, "")
    .replace(/\./g, "")
    .replace(",", ".");
}

export function parseReferenceMonth(mes: string): { month: number; year: number } {
  // "dezembro/2025 " -> { month: 12, year: 2025 }
  const months: Record<string, number> = {
    janeiro: 1,
    fevereiro: 2,
    março: 3,
    abril: 4,
    maio: 5,
    junho: 6,
    julho: 7,
    agosto: 8,
    setembro: 9,
    outubro: 10,
    novembro: 11,
    dezembro: 12,
  };

  const [monthName, yearStr] = mes.trim().toLowerCase().split("/");
  if (!months[monthName] || !/^\d{4}$/.test(yearStr ?? "") || mes.trim().split("/").length !== 2)
    throw new Error(`Invalid FIPE reference month: "${mes}"`);
  return { month: months[monthName], year: Number(yearStr) };
}
