import { NextResponse } from "next/server";
import { database, hasDatabase } from "@/lib/db";
import { requireViewer } from "@/lib/auth";
import { demoSnapshot } from "@/lib/demo-data";
import { defaultTimesheetDueDate, isoDate, payPeriodEnd, payPeriodStart } from "@/lib/date";

export async function GET() {
  if (!hasDatabase()) return NextResponse.json(demoSnapshot());
  try {
    const viewer = await requireViewer();
    const start = isoDate(payPeriodStart());
    const end = isoDate(payPeriodEnd());
    const endExclusive = new Date(`${end}T12:00:00`); endExclusive.setDate(endExclusive.getDate() + 1);
    const sql = database();
    const [staff, shifts, swaps, availability, settings] = await Promise.all([
      sql`SELECT id, name, role, active FROM staff WHERE active = true ORDER BY role DESC, name`,
      sql`SELECT s.id, s.shift_date AS date, s.title, to_char(s.starts_at, 'HH24:MI') AS "startsAt", to_char(s.ends_at, 'HH24:MI') AS "endsAt", s.status, COALESCE(string_agg(a.name, ', '), 'Open') AS assignee FROM shifts s LEFT JOIN shift_assignments sa ON sa.shift_id=s.id LEFT JOIN staff a ON a.id=sa.staff_id WHERE s.shift_date >= ${start}::date AND s.shift_date < ${isoDate(endExclusive)}::date GROUP BY s.id ORDER BY s.shift_date, s.starts_at`,
      sql`SELECT sr.id, requester.name AS requester, s.title || ' · ' || to_char(s.shift_date, 'Mon DD') AS shift, COALESCE(recipient.name, 'Open to staff') AS recipient, sr.status FROM swap_requests sr JOIN staff requester ON requester.id=sr.requester_id JOIN shifts s ON s.id=sr.shift_id LEFT JOIN staff recipient ON recipient.id=sr.recipient_id WHERE sr.status='pending' ORDER BY sr.created_at DESC`,
      sql`SELECT staff.name AS staff, COALESCE(availability.note, availability.status) AS note FROM availability JOIN staff ON staff.id=availability.staff_id WHERE availability.ends_on >= ${start}::date ORDER BY availability.created_at DESC LIMIT 8`,
      sql`SELECT to_char(timesheet_due_date, 'YYYY-MM-DD') AS "dueDate" FROM pay_period_settings WHERE period_start = ${start}::date LIMIT 1`,
    ]);
    return NextResponse.json({ demo: false, viewer, staff, shifts, swaps, availability, payPeriod: { start, end, dueDate: settings[0]?.dueDate ?? isoDate(defaultTimesheetDueDate()), defaultDueDate: isoDate(defaultTimesheetDueDate()) } });
  } catch (error) {
    return NextResponse.json({ ...demoSnapshot(), authRequired: true });
  }
}
