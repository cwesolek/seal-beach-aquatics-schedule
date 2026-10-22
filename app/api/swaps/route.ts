import { NextResponse } from "next/server";
import { database } from "@/lib/db";
import { requireViewer } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer(); const body = await request.json() as { shiftId?: string; recipientId?: string; targetShiftId?: string; note?: string };
    if (!body.shiftId) return NextResponse.json({ error: "Choose a shift first." }, { status: 400 });
    const sql = database();
    const assigned = await sql`SELECT 1 FROM shift_assignments a JOIN shifts s ON s.id=a.shift_id WHERE a.shift_id=${body.shiftId}::uuid AND a.staff_id=${viewer.id} AND s.status IN ('open', 'assigned') AND s.shift_date>=CURRENT_DATE`;
    if (!assigned.length) return NextResponse.json({ error: "You can only offer one of your assigned shifts." }, { status: 403 });
    if (body.recipientId === viewer.id) return NextResponse.json({ error: "Choose another staff member." }, { status: 400 });
    if (body.recipientId) {
      const recipient = await sql`SELECT 1 FROM staff WHERE id=${body.recipientId}::uuid AND active=true`;
      if (!recipient.length) return NextResponse.json({ error: "Choose an active staff member." }, { status: 400 });
    }
    if (body.targetShiftId) {
      if (!body.recipientId || body.targetShiftId === body.shiftId) return NextResponse.json({ error: "Choose a recipient and a different shift to swap." }, { status: 400 });
      const target = await sql`SELECT 1 FROM shift_assignments WHERE shift_id=${body.targetShiftId}::uuid AND staff_id=${body.recipientId}::uuid`;
      if (!target.length) return NextResponse.json({ error: "The recipient is no longer assigned to that shift." }, { status: 409 });
    }
    await sql`INSERT INTO swap_requests (shift_id, requester_id, recipient_id, target_shift_id, note) VALUES (${body.shiftId}::uuid, ${viewer.id}, ${body.recipientId || null}::uuid, ${body.targetShiftId || null}::uuid, ${body.note?.trim() || null})`;
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create swap request" }, { status: 401 }); }
}
