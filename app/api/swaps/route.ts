import { NextResponse } from "next/server";
import { database } from "@/lib/db";
import { requireViewer } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer(); const body = await request.json() as { shiftId?: string; recipientId?: string; note?: string };
    if (!body.shiftId) return NextResponse.json({ error: "Choose a shift first." }, { status: 400 });
    const sql = database();
    const assigned = await sql`SELECT 1 FROM shift_assignments WHERE shift_id=${body.shiftId}::uuid AND staff_id=${viewer.id}`;
    if (!assigned.length) return NextResponse.json({ error: "You can only offer one of your assigned shifts." }, { status: 403 });
    await sql`INSERT INTO swap_requests (shift_id, requester_id, recipient_id, note) VALUES (${body.shiftId}::uuid, ${viewer.id}, ${body.recipientId || null}::uuid, ${body.note?.trim() || null})`;
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create swap request" }, { status: 401 }); }
}
