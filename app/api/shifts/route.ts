import { NextResponse } from "next/server";
import { database } from "@/lib/db";
import { requireManager } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const manager = await requireManager();
    const body = await request.json() as { action?: string; date?: string; title?: string; startsAt?: string; endsAt?: string; staffId?: string; templateId?: string; shiftId?: string };
    const sql = database();
    if (body.action === "assignToShift") {
      if (!body.shiftId || !body.staffId) return NextResponse.json({ error: "Choose a staff member to assign." }, { status: 400 });
      const shift = await sql`SELECT s.id, s.required_staff AS "requiredStaff", COUNT(sa.id)::int AS "assignedCount" FROM shifts s LEFT JOIN shift_assignments sa ON sa.shift_id=s.id WHERE s.id=${body.shiftId}::uuid AND s.status != 'cancelled' GROUP BY s.id LIMIT 1`;
      if (!shift[0]) return NextResponse.json({ error: "Shift not found." }, { status: 404 });
      if (shift[0].assignedCount >= shift[0].requiredStaff) return NextResponse.json({ error: "Both positions on this shift are already filled." }, { status: 409 });
      await sql`INSERT INTO shift_assignments (shift_id, staff_id, assigned_by) VALUES (${body.shiftId}::uuid, ${body.staffId}::uuid, ${manager.id}) ON CONFLICT (shift_id, staff_id) DO NOTHING`;
      await sql`UPDATE shifts SET status=CASE WHEN (SELECT COUNT(*) FROM shift_assignments WHERE shift_id=${body.shiftId}::uuid) >= required_staff THEN 'assigned' ELSE 'open' END WHERE id=${body.shiftId}::uuid`;
      return NextResponse.json({ ok: true, message: "Staff member assigned to the shift." });
    }
    if (body.action === "assignTemplate") {
      if (!body.date || !body.templateId || !body.staffId) return NextResponse.json({ error: "Choose a staff member to assign." }, { status: 400 });
      const template = await sql`SELECT id, title, starts_at, ends_at, required_staff FROM recurring_shift_templates WHERE id=${body.templateId}::uuid AND active=true LIMIT 1`;
      if (!template[0]) return NextResponse.json({ error: "That standard shift is no longer available." }, { status: 404 });
      const existing = await sql`SELECT id FROM shifts WHERE template_id=${body.templateId}::uuid AND shift_date=${body.date}::date AND status != 'cancelled' LIMIT 1`;
      const shiftId = existing[0]?.id ?? (await sql`INSERT INTO shifts (template_id, shift_date, title, starts_at, ends_at, required_staff, status, created_by) VALUES (${body.templateId}::uuid, ${body.date}::date, ${template[0].title}, ${template[0].starts_at}, ${template[0].ends_at}, ${template[0].required_staff}, 'open', ${manager.id}) RETURNING id`)[0].id;
      const capacity = await sql`SELECT s.required_staff AS "requiredStaff", COUNT(sa.id)::int AS "assignedCount" FROM shifts s LEFT JOIN shift_assignments sa ON sa.shift_id=s.id WHERE s.id=${shiftId}::uuid GROUP BY s.id`;
      if (capacity[0].assignedCount >= capacity[0].requiredStaff) return NextResponse.json({ error: "Both positions on this shift are already filled." }, { status: 409 });
      await sql`INSERT INTO shift_assignments (shift_id, staff_id, assigned_by) VALUES (${shiftId}, ${body.staffId}::uuid, ${manager.id}) ON CONFLICT (shift_id, staff_id) DO NOTHING`;
      await sql`UPDATE shifts SET required_staff=${template[0].required_staff}, status=CASE WHEN (SELECT COUNT(*) FROM shift_assignments WHERE shift_id=${shiftId}::uuid) >= ${template[0].required_staff} THEN 'assigned' ELSE 'open' END WHERE id=${shiftId}::uuid`;
      return NextResponse.json({ ok: true, message: "Staff member assigned to the standard shift." });
    }
    if (!body.date || !body.title || !body.startsAt || !body.endsAt) return NextResponse.json({ error: "Date, title, start, and end are required." }, { status: 400 });
    if (body.endsAt <= body.startsAt) return NextResponse.json({ error: "The end time must be after the start time." }, { status: 400 });
    const created = await sql`INSERT INTO shifts (shift_date, title, starts_at, ends_at, status, created_by) VALUES (${body.date}::date, ${body.title.trim()}, ${body.startsAt}::time, ${body.endsAt}::time, ${body.staffId ? 'assigned' : 'open'}, ${manager.id}) RETURNING id`;
    if (body.staffId) await sql`INSERT INTO shift_assignments (shift_id, staff_id, assigned_by) VALUES (${created[0].id}, ${body.staffId}::uuid, ${manager.id})`;
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create shift" }, { status: 403 }); }
}

export async function PATCH(request: Request) {
  try {
    await requireManager();
    const body = await request.json() as { shiftId?: string; startsAt?: string; endsAt?: string };
    if (!body.shiftId || !body.startsAt || !body.endsAt) return NextResponse.json({ error: "Shift, start time, and end time are required." }, { status: 400 });
    if (body.endsAt <= body.startsAt) return NextResponse.json({ error: "The end time must be after the start time." }, { status: 400 });
    const sql = database();
    const updated = await sql`UPDATE shifts SET starts_at=${body.startsAt}::time, ends_at=${body.endsAt}::time WHERE id=${body.shiftId}::uuid RETURNING id`;
    if (!updated[0]) return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    return NextResponse.json({ ok: true, message: "Shift times updated." });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update shift" }, { status: 403 }); }
}
