import { NextResponse } from "next/server";
import { database } from "@/lib/db";
import { requireViewer } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer(); const body = await request.json() as { shiftId?: string; recipientShiftId?: string; additionalShiftId?: string; recipientId?: string; note?: string };
    if (!body.shiftId || !body.recipientId) return NextResponse.json({ error: "Choose the coworker you want to ask." }, { status: 400 });
    if (body.recipientShiftId === body.shiftId) return NextResponse.json({ error: "Choose two different shifts." }, { status: 400 });
    if (body.additionalShiftId === body.shiftId || body.additionalShiftId === body.recipientShiftId) return NextResponse.json({ error: "Choose different shifts for the request." }, { status: 400 });
    if (body.additionalShiftId && body.recipientShiftId) return NextResponse.json({ error: "A full-day coverage request cannot also be a shift exchange." }, { status: 400 });
    if (body.recipientId === viewer.id) return NextResponse.json({ error: "Choose another staff member." }, { status: 400 });
    const sql = database();
    const assigned = await sql`SELECT 1 FROM shift_assignments WHERE shift_id=${body.shiftId}::uuid AND staff_id=${viewer.id}`;
    if (!assigned.length) return NextResponse.json({ error: "You can only offer one of your assigned shifts." }, { status: 403 });
    const pending = await sql`SELECT id FROM swap_requests WHERE requester_id=${viewer.id}::uuid AND status='pending' AND (shift_id=${body.shiftId}::uuid OR additional_shift_id=${body.shiftId}::uuid OR (${body.additionalShiftId || null}::uuid IS NOT NULL AND (shift_id=${body.additionalShiftId || null}::uuid OR additional_shift_id=${body.additionalShiftId || null}::uuid))) LIMIT 1`;
    if (pending[0]) return NextResponse.json({ error: "You already have a pending swap request for this shift." }, { status: 409 });
    const recipient = await sql`SELECT id FROM staff WHERE id=${body.recipientId}::uuid AND active=true AND approval_status='approved' LIMIT 1`;
    if (!recipient[0]) return NextResponse.json({ error: "That coworker is not available." }, { status: 404 });
    const alreadyOnOfferedShift = await sql`SELECT 1 FROM shift_assignments WHERE shift_id=${body.shiftId}::uuid AND staff_id=${body.recipientId}::uuid LIMIT 1`;
    if (alreadyOnOfferedShift[0]) return NextResponse.json({ error: "That coworker is already working this shift." }, { status: 409 });
    if (body.recipientShiftId) {
      const recipientAssignment = await sql`SELECT id FROM shift_assignments WHERE shift_id=${body.recipientShiftId}::uuid AND staff_id=${body.recipientId}::uuid LIMIT 1`;
      if (!recipientAssignment[0]) return NextResponse.json({ error: "That coworker is no longer assigned to the requested shift." }, { status: 409 });
      const requesterConflict = await sql`SELECT 1 FROM shift_assignments WHERE shift_id=${body.recipientShiftId}::uuid AND staff_id=${viewer.id}::uuid LIMIT 1`;
      if (requesterConflict[0]) return NextResponse.json({ error: "You are already working the shift you requested." }, { status: 409 });
    }
    if (body.additionalShiftId) {
      const fullDay = await sql`SELECT 1 FROM shift_assignments first_assignment JOIN shifts first_shift ON first_shift.id=first_assignment.shift_id JOIN shift_assignments second_assignment ON second_assignment.staff_id=first_assignment.staff_id JOIN shifts second_shift ON second_shift.id=second_assignment.shift_id WHERE first_assignment.shift_id=${body.shiftId}::uuid AND second_assignment.shift_id=${body.additionalShiftId}::uuid AND first_assignment.staff_id=${viewer.id}::uuid AND first_shift.shift_date=second_shift.shift_date AND lower(first_shift.title)='morning' AND lower(second_shift.title)='midday' AND COALESCE(first_assignment.scheduled_ends_at, first_shift.ends_at)=COALESCE(second_assignment.scheduled_starts_at, second_shift.starts_at) LIMIT 1`;
      if (!fullDay[0]) return NextResponse.json({ error: "Those shifts are no longer an eligible full-day assignment." }, { status: 409 });
      const recipientConflict = await sql`SELECT 1 FROM shift_assignments WHERE shift_id=${body.additionalShiftId}::uuid AND staff_id=${body.recipientId}::uuid LIMIT 1`;
      if (recipientConflict[0]) return NextResponse.json({ error: "That coworker is already working part of this full day." }, { status: 409 });
    }
    await sql`INSERT INTO swap_requests (shift_id, recipient_shift_id, additional_shift_id, requester_id, recipient_id, note) VALUES (${body.shiftId}::uuid, ${body.recipientShiftId || null}::uuid, ${body.additionalShiftId || null}::uuid, ${viewer.id}, ${body.recipientId}::uuid, ${body.note?.trim() || null})`;
    return NextResponse.json({ ok: true, message: body.recipientShiftId ? "Shift exchange requested. It will finalize when the other employee accepts." : body.additionalShiftId ? "Full-day coverage requested. Both shifts will transfer when the other employee accepts." : "Coverage requested. It will finalize when the other employee accepts." });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create swap request" }, { status: 401 }); }
}
