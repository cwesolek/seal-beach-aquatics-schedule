export function weekStart(input = new Date()) {
  const date = new Date(input);
  date.setHours(12, 0, 0, 0);
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  return date;
}

export function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function payPeriodStart(input = new Date()) {
  const anchor = new Date("2026-08-17T12:00:00");
  const day = 86_400_000;
  const periods = Math.floor((weekStart(input).getTime() - anchor.getTime()) / (14 * day));
  const result = new Date(anchor);
  result.setDate(anchor.getDate() + periods * 14);
  return result;
}
