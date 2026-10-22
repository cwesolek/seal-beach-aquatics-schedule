import { NextResponse } from "next/server";
import { requireViewer } from "@/lib/auth";
import { database } from "@/lib/db";

const rowTypes = new Set(["regular", "sick", "overtime", "other"]);
const adjustmentKeys = new Set(["flex", "prior"]);

export async function PUT(request: Request) {
  try {
    const viewer = await requireViewer();
    const body = await request.json() as { staffId?: string; periodStart?: string; periodEnd?: string; entries?: Array<{ rowType?: string; entryKey?: string; hours?: number }> };
    if (!body.periodStart || !body.periodEnd || !/^\d{4}-\d{2}-\d{2}$/.test(body.periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(body.periodEnd) || !Array.isArray(body.entries)) return NextResponse.json({ error: "Pay period and timesheet entries are required." }, { status: 400 });
    const periodStart = new Date(`${body.periodStart}T12:00:00Z`); const periodEnd = new Date(`${body.periodEnd}T12:00:00Z`);
    if ((periodEnd.getTime() - periodStart.getTime()) / 86400000 !== 13 || body.entries.length > 64) return NextResponse.json({ error: "Timesheets must cover one 14-day pay period." }, { status: 400 });
    const entries = body.entries.map((entry) => ({ rowType: entry.rowType ?? "", entryKey: entry.entryKey ?? "", hours: Number(entry.hours) }));
    const uniqueCells = new Set(entries.map((entry) => `${entry.rowType}:${entry.entryKey}`));
    if (uniqueCells.size !== entries.length) return NextResponse.json({ error: "Duplicate timesheet cells are not allowed." }, { status: 400 });
    for (const entry of entries) {
      const daily = /^\d{4}-\d{2}-\d{2}$/.test(entry.entryKey) && entry.entryKey >= body.periodStart && entry.entryKey <= body.periodEnd;
      const negativePriorAdjustment = entry.entryKey === "prior" && entry.hours >= -999.5;
      if (!rowTypes.has(entry.rowType) || (!daily && !adjustmentKeys.has(entry.entryKey)) || !Number.isFinite(entry.hours) || (entry.hours < 0 && !negativePriorAdjustment) || entry.hours > 999.5 || Math.round(entry.hours * 2) !== entry.hours * 2 || (daily && entry.hours > 24)) return NextResponse.json({ error: "Hours must use half-hour increments. Only prior-period adjustments may be negative." }, { status: 400 });
    }
    const sql = database();
    const staffId = viewer.role === "manager" && body.staffId ? body.staffId : viewer.id;
    if (staffId !== viewer.id) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(staffId)) return NextResponse.json({ error: "That staff member is not available." }, { status: 404 });
      const target = await sql`SELECT id FROM staff WHERE id=${staffId}::uuid AND active=true AND approval_status='approved' LIMIT 1`;
      if (!target[0]) return NextResponse.json({ error: "That staff member is not available." }, { status: 404 });
    }
    const payload = JSON.stringify(entries);
    await sql`WITH cleared AS (DELETE FROM timesheet_entries WHERE staff_id=${staffId}::uuid AND period_start=${body.periodStart}::date) INSERT INTO timesheet_entries (staff_id, period_start, row_type, entry_key, hours) SELECT ${staffId}::uuid, ${body.periodStart}::date, entry."rowType", entry."entryKey", entry.hours FROM jsonb_to_recordset(${payload}::jsonb) AS entry("rowType" text, "entryKey" text, hours numeric)`;
    return NextResponse.json({ ok: true, message: "Timesheet saved." });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save timesheet" }, { status: 403 }); }
}
