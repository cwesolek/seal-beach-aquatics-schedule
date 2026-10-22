import { NextResponse } from "next/server";
import { database } from "@/lib/db";
import { requireManager } from "@/lib/auth";

async function assignmentSnapshot(sql: ReturnType<typeof database>, shiftId: string) {
  const rows = await sql`SELECT s.id, s.template_id AS "templateId", to_char(s.shift_date, 'YYYY-MM-DD') AS date, s.title, to_char(s.starts_at, 'HH24:MI') AS "startsAt", to_char(s.ends_at, 'HH24:MI') AS "endsAt", s.required_staff AS "requiredStaff", COUNT(sa.id)::int AS "assignedCount", s.status, COALESCE(string_agg(a.name, ', ' ORDER BY sa.created_at), 'Open') AS assignee, COALESCE(json_agg(json_build_object('id', a.id::text, 'name', a.name, 'scheduledStartsAt', CASE WHEN sa.scheduled_starts_at IS NULL THEN NULL ELSE to_char(sa.scheduled_starts_at, 'HH24:MI') END, 'scheduledEndsAt', CASE WHEN sa.scheduled_ends_at IS NULL THEN NULL ELSE to_char(sa.scheduled_ends_at, 'HH24:MI') END, 'isRecurring', EXISTS (SELECT 1 FROM recurring_staff_assignments recurring WHERE recurring.template_id=s.template_id AND recurring.staff_id=a.id AND recurring.active=true AND recurring.starts_on<=s.shift_date)) ORDER BY sa.created_at) FILTER (WHERE a.id IS NOT NULL), '[]'::json) AS "assignedStaff" FROM shifts s LEFT JOIN shift_assignments sa ON sa.shift_id=s.id LEFT JOIN staff a ON a.id=sa.staff_id WHERE s.id=${shiftId}::uuid GROUP BY s.id LIMIT 1`;
  return rows[0];
}

export async function POST(request: Request) {
  try {
    const manager = await requireManager();
    const body = await request.json() as { action?: string; date?: string; title?: string; startsAt?: string; endsAt?: string; staffId?: string; templateId?: string; shiftId?: string; requiredStaff?: number; recurring?: boolean; stopRecurring?: boolean; weekStart?: string; enabled?: boolean };
    const sql = database();
    if (body.action === "setAquaticsClassWeek") {
      if (!body.weekStart || typeof body.enabled !== "boolean" || !/^\d{4}-\d{2}-\d{2}$/.test(body.weekStart)) return NextResponse.json({ error: "Week and availability setting are required." }, { status: 400 });
      const weekStart = new Date(`${body.weekStart}T12:00:00`);
      if (Number.isNaN(weekStart.getTime()) || weekStart.getDay() !== 0) return NextResponse.json({ error: "Aquatics class weeks must begin on Sunday." }, { status: 400 });
      if (body.enabled) {
        await sql`DELETE FROM aquatics_class_week_exclusions WHERE week_start=${body.weekStart}::date`;
        return NextResponse.json({ ok: true, message: "Aquatics class restored for this week." });
      }
      await sql`INSERT INTO aquatics_class_week_exclusions (week_start, created_by) VALUES (${body.weekStart}::date, ${manager.id}::uuid) ON CONFLICT (week_start) DO NOTHING`;
      await sql`DELETE FROM shifts WHERE lower(title)='aquatics class' AND shift_date BETWEEN ${body.weekStart}::date AND ${body.weekStart}::date + 6`;
      return NextResponse.json({ ok: true, message: "Aquatics class removed for this week, including its assignments." });
    }
    if (body.action === "setAquaticsClassCapacity") {
      if (!body.date || !body.templateId || !Number.isInteger(body.requiredStaff) || body.requiredStaff! < 2 || body.requiredStaff! > 5) return NextResponse.json({ error: "Date, Aquatics class, and a capacity between two and five are required." }, { status: 400 });
      const template = await sql`SELECT id, title, starts_at, ends_at FROM recurring_shift_templates WHERE id=${body.templateId}::uuid AND active=true AND lower(title)='aquatics class' LIMIT 1`;
      if (!template[0]) return NextResponse.json({ error: "Aquatics class template not found." }, { status: 404 });
      const existing = await sql`SELECT shift.id, COUNT(assignment.id)::int AS "assignedCount" FROM shifts shift LEFT JOIN shift_assignments assignment ON assignment.shift_id=shift.id WHERE shift.template_id=${body.templateId}::uuid AND shift.shift_date=${body.date}::date AND shift.status!='cancelled' GROUP BY shift.id LIMIT 1`;
      if (existing[0]?.assignedCount > body.requiredStaff!) return NextResponse.json({ error: `Remove assigned guards until ${body.requiredStaff} or fewer remain before reducing this class to ${body.requiredStaff} positions.` }, { status: 409 });
      const shiftId = existing[0]?.id ?? (await sql`INSERT INTO shifts (template_id, shift_date, title, starts_at, ends_at, required_staff, status, created_by) VALUES (${body.templateId}::uuid, ${body.date}::date, ${template[0].title}, ${template[0].starts_at}, ${template[0].ends_at}, ${body.requiredStaff}, 'open', ${manager.id}::uuid) RETURNING id`)[0].id;
      await sql`UPDATE shifts SET required_staff=${body.requiredStaff}, status=CASE WHEN (SELECT COUNT(*) FROM shift_assignments WHERE shift_id=${shiftId}::uuid)>=${body.requiredStaff} THEN 'assigned' ELSE 'open' END WHERE id=${shiftId}::uuid`;
      return NextResponse.json({ ok: true, message: `Aquatics class updated to ${body.requiredStaff} guard positions for this date.`, shift: await assignmentSnapshot(sql, shiftId) });
    }
    if (body.action === "updateAssignmentTime") {
      if (!body.shiftId || !body.staffId || !body.startsAt || !body.endsAt) return NextResponse.json({ error: "Employee, shift, start time, and end time are required." }, { status: 400 });
      if (body.endsAt <= body.startsAt) return NextResponse.json({ error: "The employee's end time must be after their start time." }, { status: 400 });
      const assignment = await sql`SELECT shift.template_id AS "templateId", shift.shift_date AS "shiftDate" FROM shift_assignments assignment JOIN shifts shift ON shift.id=assignment.shift_id WHERE assignment.shift_id=${body.shiftId}::uuid AND assignment.staff_id=${body.staffId}::uuid LIMIT 1`;
      if (!assignment[0]) return NextResponse.json({ error: "That employee is no longer assigned to this shift." }, { status: 404 });
      if (body.recurring && !assignment[0].templateId) return NextResponse.json({ error: "Weekly employee times are available only for standard shifts." }, { status: 409 });
      await sql`UPDATE shift_assignments SET scheduled_starts_at=${body.startsAt}::time, scheduled_ends_at=${body.endsAt}::time WHERE shift_id=${body.shiftId}::uuid AND staff_id=${body.staffId}::uuid`;
      if (body.recurring) {
        await sql`INSERT INTO recurring_staff_assignments (template_id, staff_id, starts_on, scheduled_starts_at, scheduled_ends_at, created_by, active) VALUES (${assignment[0].templateId}::uuid, ${body.staffId}::uuid, ${assignment[0].shiftDate}, ${body.startsAt}::time, ${body.endsAt}::time, ${manager.id}::uuid, true) ON CONFLICT (template_id, staff_id) DO UPDATE SET starts_on=EXCLUDED.starts_on, scheduled_starts_at=EXCLUDED.scheduled_starts_at, scheduled_ends_at=EXCLUDED.scheduled_ends_at, created_by=EXCLUDED.created_by, active=true`;
        await sql`UPDATE shift_assignments future SET scheduled_starts_at=${body.startsAt}::time, scheduled_ends_at=${body.endsAt}::time FROM shifts shift WHERE future.shift_id=shift.id AND future.staff_id=${body.staffId}::uuid AND shift.template_id=${assignment[0].templateId}::uuid AND shift.shift_date>=${assignment[0].shiftDate}`;
      }
      return NextResponse.json({ ok: true, message: body.recurring ? "Employee time updated for this and future weekly shifts." : "Employee time updated for this shift only.", shift: await assignmentSnapshot(sql, body.shiftId) });
    }
    if (body.action === "unassignFromShift") {
      if (!body.shiftId || !body.staffId) return NextResponse.json({ error: "Shift and staff member are required." }, { status: 400 });
      const shift = await sql`SELECT template_id, shift_date FROM shifts WHERE id=${body.shiftId}::uuid LIMIT 1`;
      if (body.stopRecurring) {
        if (shift[0]?.template_id) {
          await sql`UPDATE recurring_staff_assignments SET active=false WHERE template_id=${shift[0].template_id}::uuid AND staff_id=${body.staffId}::uuid`;
          await sql`DELETE FROM shift_assignments assignment USING shifts future_shift WHERE assignment.shift_id=future_shift.id AND assignment.staff_id=${body.staffId}::uuid AND future_shift.template_id=${shift[0].template_id}::uuid AND future_shift.shift_date>=${shift[0].shift_date}`;
          await sql`UPDATE shifts SET status=CASE WHEN (SELECT COUNT(*) FROM shift_assignments WHERE shift_id=shifts.id)>=required_staff THEN 'assigned' ELSE 'open' END WHERE template_id=${shift[0].template_id}::uuid AND shift_date>=${shift[0].shift_date} AND status!='cancelled'`;
          return NextResponse.json({ ok: true, message: "Recurring weekly assignment removed from this date forward.", shift: await assignmentSnapshot(sql, body.shiftId) });
        }
      }
      if (shift[0]?.template_id) {
        const recurring = await sql`SELECT id FROM recurring_staff_assignments WHERE template_id=${shift[0].template_id}::uuid AND staff_id=${body.staffId}::uuid AND active=true AND starts_on<=${shift[0].shift_date}::date LIMIT 1`;
        if (recurring[0]) await sql`INSERT INTO recurring_assignment_exclusions (template_id, staff_id, shift_date, created_by) VALUES (${shift[0].template_id}::uuid, ${body.staffId}::uuid, ${shift[0].shift_date}, ${manager.id}::uuid) ON CONFLICT DO NOTHING`;
      }
      const removed = await sql`DELETE FROM shift_assignments WHERE shift_id=${body.shiftId}::uuid AND staff_id=${body.staffId}::uuid RETURNING id`;
      if (!removed[0]) return NextResponse.json({ error: "That staff member is no longer assigned to this shift." }, { status: 404 });
      await sql`UPDATE shifts SET status=CASE WHEN (SELECT COUNT(*) FROM shift_assignments WHERE shift_id=${body.shiftId}::uuid) >= required_staff THEN 'assigned' ELSE 'open' END WHERE id=${body.shiftId}::uuid`;
      return NextResponse.json({ ok: true, message: "Staff member removed from this date only.", shift: await assignmentSnapshot(sql, body.shiftId) });
    }
    if (body.action === "assignToShift") {
      if (!body.shiftId || !body.staffId) return NextResponse.json({ error: "Choose a staff member to assign." }, { status: 400 });
      const shift = await sql`SELECT s.id, s.template_id AS "templateId", s.shift_date AS "shiftDate", s.required_staff AS "requiredStaff", COUNT(sa.id)::int AS "assignedCount" FROM shifts s LEFT JOIN shift_assignments sa ON sa.shift_id=s.id WHERE s.id=${body.shiftId}::uuid AND s.status != 'cancelled' GROUP BY s.id LIMIT 1`;
      if (!shift[0]) return NextResponse.json({ error: "Shift not found." }, { status: 404 });
      if (body.recurring && !shift[0].templateId) return NextResponse.json({ error: "Weekly recurrence is available only for standard shifts." }, { status: 409 });
      if (shift[0].assignedCount >= shift[0].requiredStaff) return NextResponse.json({ error: "All guard positions on this shift are already filled." }, { status: 409 });
      const inserted = await sql`INSERT INTO shift_assignments (shift_id, staff_id, assigned_by) VALUES (${body.shiftId}::uuid, ${body.staffId}::uuid, ${manager.id}) ON CONFLICT (shift_id, staff_id) DO NOTHING RETURNING id`;
      if (!inserted[0]) return NextResponse.json({ error: "That staff member is already assigned to this shift." }, { status: 409 });
      if (shift[0].templateId) await sql`DELETE FROM recurring_assignment_exclusions WHERE template_id=${shift[0].templateId}::uuid AND staff_id=${body.staffId}::uuid AND shift_date=${shift[0].shiftDate}`;
      if (body.recurring) {
        await sql`INSERT INTO recurring_staff_assignments (template_id, staff_id, starts_on, created_by, active) VALUES (${shift[0].templateId}::uuid, ${body.staffId}::uuid, ${shift[0].shiftDate}, ${manager.id}::uuid, true) ON CONFLICT (template_id, staff_id) DO UPDATE SET starts_on=EXCLUDED.starts_on, created_by=EXCLUDED.created_by, active=true`;
      }
      await sql`UPDATE shifts SET status=CASE WHEN (SELECT COUNT(*) FROM shift_assignments WHERE shift_id=${body.shiftId}::uuid) >= required_staff THEN 'assigned' ELSE 'open' END WHERE id=${body.shiftId}::uuid`;
      return NextResponse.json({ ok: true, message: "Staff member assigned to the shift.", shift: await assignmentSnapshot(sql, body.shiftId) });
    }
    if (body.action === "assignTemplate") {
      if (!body.date || !body.templateId || !body.staffId) return NextResponse.json({ error: "Choose a staff member to assign." }, { status: 400 });
      const template = await sql`SELECT id, title, starts_at, ends_at, required_staff FROM recurring_shift_templates WHERE id=${body.templateId}::uuid AND active=true LIMIT 1`;
      if (!template[0]) return NextResponse.json({ error: "That standard shift is no longer available." }, { status: 404 });
      const existing = await sql`SELECT id FROM shifts WHERE template_id=${body.templateId}::uuid AND shift_date=${body.date}::date AND status != 'cancelled' LIMIT 1`;
      const shiftId = existing[0]?.id ?? (await sql`INSERT INTO shifts (template_id, shift_date, title, starts_at, ends_at, required_staff, status, created_by) VALUES (${body.templateId}::uuid, ${body.date}::date, ${template[0].title}, ${template[0].starts_at}, ${template[0].ends_at}, ${template[0].required_staff}, 'open', ${manager.id}) RETURNING id`)[0].id;
      const capacity = await sql`SELECT s.required_staff AS "requiredStaff", COUNT(sa.id)::int AS "assignedCount" FROM shifts s LEFT JOIN shift_assignments sa ON sa.shift_id=s.id WHERE s.id=${shiftId}::uuid GROUP BY s.id`;
      if (capacity[0].assignedCount >= capacity[0].requiredStaff) return NextResponse.json({ error: "All guard positions on this shift are already filled." }, { status: 409 });
      const inserted = await sql`INSERT INTO shift_assignments (shift_id, staff_id, assigned_by) VALUES (${shiftId}, ${body.staffId}::uuid, ${manager.id}) ON CONFLICT (shift_id, staff_id) DO NOTHING RETURNING id`;
      if (!inserted[0]) return NextResponse.json({ error: "That staff member is already assigned to this shift." }, { status: 409 });
      await sql`DELETE FROM recurring_assignment_exclusions WHERE template_id=${body.templateId}::uuid AND staff_id=${body.staffId}::uuid AND shift_date=${body.date}::date`;
      if (body.recurring) await sql`INSERT INTO recurring_staff_assignments (template_id, staff_id, starts_on, created_by, active) VALUES (${body.templateId}::uuid, ${body.staffId}::uuid, ${body.date}::date, ${manager.id}::uuid, true) ON CONFLICT (template_id, staff_id) DO UPDATE SET starts_on=EXCLUDED.starts_on, created_by=EXCLUDED.created_by, active=true`;
      await sql`UPDATE shifts SET status=CASE WHEN (SELECT COUNT(*) FROM shift_assignments WHERE shift_id=${shiftId}::uuid) >= required_staff THEN 'assigned' ELSE 'open' END WHERE id=${shiftId}::uuid`;
      return NextResponse.json({ ok: true, message: body.recurring ? "Staff member assigned to this weekly recurring shift." : "Staff member assigned to the standard shift.", shift: await assignmentSnapshot(sql, shiftId) });
    }
    if (!body.date || !body.title || !body.startsAt || !body.endsAt) return NextResponse.json({ error: "Date, title, start, and end are required." }, { status: 400 });
    if (body.endsAt <= body.startsAt) return NextResponse.json({ error: "The end time must be after the start time." }, { status: 400 });
    const requiredStaff = Number(body.requiredStaff ?? 2);
    if (!Number.isInteger(requiredStaff) || requiredStaff < 1 || requiredStaff > 20) return NextResponse.json({ error: "Required guards must be between 1 and 20." }, { status: 400 });
    const created = await sql`INSERT INTO shifts (shift_date, title, starts_at, ends_at, required_staff, status, created_by) VALUES (${body.date}::date, ${body.title.trim()}, ${body.startsAt}::time, ${body.endsAt}::time, ${requiredStaff}, ${body.staffId && requiredStaff === 1 ? 'assigned' : 'open'}, ${manager.id}) RETURNING id`;
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

export async function DELETE(request: Request) {
  try {
    await requireManager();
    const body = await request.json() as { shiftId?: string };
    if (!body.shiftId) return NextResponse.json({ error: "Shift is required." }, { status: 400 });
    const sql = database();
    const removed = await sql`DELETE FROM shifts WHERE id=${body.shiftId}::uuid AND template_id IS NULL RETURNING id`;
    if (!removed[0]) return NextResponse.json({ error: "Only non-standard shifts can be deleted. Recurring shifts are protected." }, { status: 409 });
    return NextResponse.json({ ok: true, message: "Non-standard shift deleted." });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to delete shift" }, { status: 403 }); }
}
