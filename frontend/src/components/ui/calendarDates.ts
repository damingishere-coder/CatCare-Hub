export function localDateValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function monthGrid(
  month: Date,
  weekStartsOn: 0 | 1 = 0,
  fixedWeeks = false,
): Array<Date | null> {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() - weekStartsOn + 7) % 7;
  const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const length = fixedWeeks ? 42 : offset + lastDay;
  return Array.from({ length }, (_, index) => {
    const day = index - offset + 1;
    return day >= 1 && day <= lastDay
      ? new Date(month.getFullYear(), month.getMonth(), day)
      : null;
  });
}

export function expandDateRange(start: string | null, end: string | null): string[] {
  if (!start || !end) return [];
  const current = parseLocalDate(start);
  const last = parseLocalDate(end);
  if (Number.isNaN(current.getTime()) || Number.isNaN(last.getTime()) || last < current) return [];
  const values: string[] = [];
  while (current <= last && values.length < 366) {
    values.push(localDateValue(current));
    current.setDate(current.getDate() + 1);
  }
  return values;
}
