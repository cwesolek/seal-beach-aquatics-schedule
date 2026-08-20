import { NextResponse } from "next/server";
import { requireManager } from "@/lib/auth";
import { database } from "@/lib/db";
import { defaultTimesheetDueDate, isoDate, payPeriodEnd, payPeriodStart } from "@/lib/date";

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

export async function GET() {
  const start = isoDate(payPeriodStart());
  const end = isoDate(payPeriodEnd());
  const sql = database();
  const settings = await sql`SELECT to_char(timesheet_due_date, 'YYYY-MM-DD') AS "dueDate" FROM pay_period_settings WHERE period_start = ${start}::date LIMIT 1`;
  return NextResponse.json({ start, end, dueDate: settings[0]?.dueDate ?? isoDate(defaultTimesheetDueDate()), defaultDueDate: isoDate(defaultTimesheetDueDate()) });
}

export async function PATCH(request: Request) {
  try {
    const viewer = await requireManager();
    const { dueDate } = await request.json();
    if (!validDate(dueDate)) return NextResponse.json({ error: "Enter a valid timesheet due date." }, { status: 400 });
    const start = isoDate(payPeriodStart());
    const sql = database();
    await sql`INSERT INTO pay_period_settings (period_start, timesheet_due_date, updated_by)
      VALUES (${start}::date, ${dueDate}::date, ${viewer.id})
      ON CONFLICT (period_start) DO UPDATE SET timesheet_due_date = EXCLUDED.timesheet_due_date, updated_by = EXCLUDED.updated_by, updated_at = now()`;
    return NextResponse.json({ ok: true, message: "Timesheet due date updated." });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update the due date." }, { status: 403 });
  }
}
