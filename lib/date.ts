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
  // Aug. 16–29, 2026 is the active period described by Seal Beach Aquatics.
  // Every period begins on a Sunday and spans exactly fourteen calendar days.
  const anchor = new Date("2026-08-16T12:00:00");
  const date = new Date(input);
  date.setHours(12, 0, 0, 0);
  const day = 86_400_000;
  const periods = Math.floor((date.getTime() - anchor.getTime()) / (14 * day));
  const result = new Date(anchor);
  result.setDate(anchor.getDate() + periods * 14);
  return result;
}

export function payPeriodEnd(input = new Date()) {
  const end = payPeriodStart(input);
  end.setDate(end.getDate() + 13);
  return end;
}

export function defaultTimesheetDueDate(input = new Date()) {
  const dueDate = payPeriodEnd(input);
  // Timesheets are normally due on the Wednesday before the final Saturday.
  dueDate.setDate(dueDate.getDate() - 3);
  return dueDate;
}
