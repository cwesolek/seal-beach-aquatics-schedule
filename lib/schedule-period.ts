const day = 86_400_000;
const anchor = Date.UTC(2026, 7, 16);
export function validPeriodStart(value: unknown): value is string {
  if (typeof value !== "string" || !/^20\d\d-\d{2}-\d{2}$/.test(value)) return false;
  const stamp = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0,10) === value && (Date.parse(`${value}T00:00:00Z`) - anchor) % (14 * day) === 0;
}
export function periodEnd(start: string) { return new Date(Date.parse(`${start}T00:00:00Z`) + 13 * day).toISOString().slice(0,10); }
export function periodOffsetFrom(start: string, currentStart: string) { return Math.round((Date.parse(`${start}T00:00:00Z`) - Date.parse(`${currentStart}T00:00:00Z`)) / (14 * day)); }
export function schedulePath(start: string) { return `/?tab=Schedule&periodStart=${start}`; }

export function scheduleSignInTarget(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/?")) return "/";
  try { const start = new URL(value,"https://sba-schedule.com").searchParams.get("periodStart"); return validPeriodStart(start) ? schedulePath(start) : "/"; } catch { return "/"; }
}
