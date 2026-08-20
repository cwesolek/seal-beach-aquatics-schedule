import { NextResponse } from "next/server";
import { database } from "@/lib/db";
import { requireManager } from "@/lib/auth";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const manager = await requireManager(); const { id } = await params;
    const { action } = await request.json() as { action?: "approve" | "decline" };
    if (!action) return NextResponse.json({ error: "An action is required." }, { status: 400 });
    const sql = database();
    const rows = await sql`SELECT shift_id, requester_id, recipient_id FROM swap_requests WHERE id=${id}::uuid AND status='pending'`;
    const requestRow = rows[0] as { shift_id: string; requester_id: string; recipient_id: string | null } | undefined;
    if (!requestRow) return NextResponse.json({ error: "This request is no longer available." }, { status: 404 });
    if (action === "approve") {
      if (!requestRow.recipient_id) return NextResponse.json({ error: "A recipient must accept this swap before approval." }, { status: 400 });
      await sql`DELETE FROM shift_assignments WHERE shift_id=${requestRow.shift_id}::uuid AND staff_id=${requestRow.requester_id}`;
      await sql`INSERT INTO shift_assignments (shift_id, staff_id, assigned_by) VALUES (${requestRow.shift_id}::uuid, ${requestRow.recipient_id}::uuid, ${manager.id}) ON CONFLICT DO NOTHING`;
    }
    await sql`UPDATE swap_requests SET status=${action === 'approve' ? 'approved' : 'declined'}, reviewed_by=${manager.id}, reviewed_at=now() WHERE id=${id}::uuid`;
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to review request" }, { status: 403 }); }
}
