export interface ReferenceMonth {
  month: number;
  year: number;
}

export function parseReferenceMonth(mes: string): ReferenceMonth {
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

  const [monthName, yearStr] = mes.trim().toLowerCase().split('/');
  return {
    month: months[monthName] || 0,
    year: Number.parseInt(yearStr, 10),
  };
}
