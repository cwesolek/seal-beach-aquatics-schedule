import { NextResponse } from "next/server";
import { database } from "@/lib/db";
import { requireManager, requireViewer } from "@/lib/auth";
import { ensureHourAdjustmentSchema } from "@/lib/hour-adjustments";

function isHalfHour(value: string) {
  return /^([01]\d|2[0-3]):(00|30)$/.test(value);
}

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer();
    const body = await request.json() as { shiftId?: string; startsAt?: string; endsAt?: string; note?: string };
    if (!body.shiftId || !body.startsAt || !body.endsAt) return NextResponse.json({ error: "Shift, start time, and end time are required." }, { status: 400 });
    if (!isHalfHour(body.startsAt) || !isHalfHour(body.endsAt)) return NextResponse.json({ error: "Worked times must use 30-minute increments." }, { status: 400 });
    if (body.endsAt <= body.startsAt) return NextResponse.json({ error: "The end time must be after the start time." }, { status: 400 });
    const sql = database();
    await ensureHourAdjustmentSchema(sql);
    const assignment = await sql`SELECT sa.id FROM shift_assignments sa WHERE sa.shift_id=${body.shiftId}::uuid AND sa.staff_id=${viewer.id}::uuid LIMIT 1`;
    if (!assignment[0]) return NextResponse.json({ error: "You are not assigned to that shift." }, { status: 403 });
    const created = await sql`INSERT INTO worked_shift_adjustment_requests (shift_id, staff_id, requested_starts_at, requested_ends_at, note) VALUES (${body.shiftId}::uuid, ${viewer.id}::uuid, ${body.startsAt}::time, ${body.endsAt}::time, ${body.note?.trim() || null}) ON CONFLICT (shift_id, staff_id) WHERE status='pending' DO NOTHING RETURNING id`;
    if (!created[0]) return NextResponse.json({ error: "You already have a pending hours request for this shift." }, { status: 409 });
    return NextResponse.json({ ok: true, message: "Worked hours sent to a manager for approval." });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to submit worked hours" }, { status: 403 }); }
}

export async function PATCH(request: Request) {
  try {
    const manager = await requireManager();
    const body = await request.json() as { requestId?: string; action?: "approve" | "decline" };
    if (!body.requestId || !["approve", "decline"].includes(body.action ?? "")) return NextResponse.json({ error: "Request and review decision are required." }, { status: 400 });
    const sql = database();
    await ensureHourAdjustmentSchema(sql);
    const requests = await sql`SELECT id, shift_id, staff_id, requested_starts_at, requested_ends_at FROM worked_shift_adjustment_requests WHERE id=${body.requestId}::uuid AND status='pending' LIMIT 1`;
    const item = requests[0];
    if (!item) return NextResponse.json({ error: "That hours request was already reviewed or no longer exists." }, { status: 404 });
    if (body.action === "approve") await sql`UPDATE shift_assignments SET actual_starts_at=${item.requested_starts_at}, actual_ends_at=${item.requested_ends_at} WHERE shift_id=${item.shift_id} AND staff_id=${item.staff_id}`;
    await sql`UPDATE worked_shift_adjustment_requests SET status=${body.action === "approve" ? "approved" : "declined"}, reviewed_by=${manager.id}, reviewed_at=now() WHERE id=${body.requestId}::uuid`;
    return NextResponse.json({ ok: true, message: body.action === "approve" ? "Worked hours approved." : "Worked hours declined." });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to review worked hours" }, { status: 403 }); }
}
