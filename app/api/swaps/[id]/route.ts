import { NextResponse } from "next/server";
import { database } from "@/lib/db";
import { requireManager } from "@/lib/auth";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const manager = await requireManager(); const { id } = await params;
    const { action } = await request.json() as { action?: "approve" | "decline" };
    if (!action) return NextResponse.json({ error: "An action is required." }, { status: 400 });
    const sql = database();
    const rows = await sql`SELECT shift_id, recipient_shift_id, requester_id, recipient_id, recipient_accepted_at FROM swap_requests WHERE id=${id}::uuid AND status='pending'`;
    const requestRow = rows[0] as { shift_id: string; recipient_shift_id: string | null; requester_id: string; recipient_id: string | null; recipient_accepted_at: string | null } | undefined;
    if (!requestRow) return NextResponse.json({ error: "This request is no longer available." }, { status: 404 });
    if (action === "approve") {
      if (!requestRow.recipient_id || !requestRow.recipient_accepted_at) return NextResponse.json({ error: "The requested employee must accept before manager approval." }, { status: 409 });
      if (!requestRow.recipient_shift_id) {
        const covered = await sql`
          WITH eligible AS (
            SELECT 1 WHERE
              EXISTS (SELECT 1 FROM shift_assignments WHERE shift_id=${requestRow.shift_id}::uuid AND staff_id=${requestRow.requester_id}::uuid)
              AND NOT EXISTS (SELECT 1 FROM shift_assignments WHERE shift_id=${requestRow.shift_id}::uuid AND staff_id=${requestRow.recipient_id}::uuid)
          ), removed AS (
            DELETE FROM shift_assignments WHERE shift_id=${requestRow.shift_id}::uuid AND staff_id=${requestRow.requester_id}::uuid AND EXISTS (SELECT 1 FROM eligible) RETURNING id
          ), assigned AS (
            INSERT INTO shift_assignments (shift_id, staff_id, assigned_by)
            SELECT ${requestRow.shift_id}::uuid, ${requestRow.recipient_id}::uuid, ${manager.id}::uuid
            WHERE EXISTS (SELECT 1 FROM removed) RETURNING id
          )
          UPDATE swap_requests SET status='approved', reviewed_by=${manager.id}::uuid, reviewed_at=now()
          WHERE id=${id}::uuid AND EXISTS (SELECT 1 FROM assigned) RETURNING id`;
        if (!covered[0]) return NextResponse.json({ error: "The shift assignment changed. Coverage was not finalized." }, { status: 409 });
        return NextResponse.json({ ok: true, message: "Shift coverage approved and finalized." });
      }
      const finalized = await sql`
        WITH eligible AS (
          SELECT 1 WHERE
            EXISTS (SELECT 1 FROM shift_assignments WHERE shift_id=${requestRow.shift_id}::uuid AND staff_id=${requestRow.requester_id}::uuid)
            AND EXISTS (SELECT 1 FROM shift_assignments WHERE shift_id=${requestRow.recipient_shift_id}::uuid AND staff_id=${requestRow.recipient_id}::uuid)
            AND NOT EXISTS (SELECT 1 FROM shift_assignments WHERE shift_id=${requestRow.shift_id}::uuid AND staff_id=${requestRow.recipient_id}::uuid)
            AND NOT EXISTS (SELECT 1 FROM shift_assignments WHERE shift_id=${requestRow.recipient_shift_id}::uuid AND staff_id=${requestRow.requester_id}::uuid)
        ), removed_requester AS (
          DELETE FROM shift_assignments WHERE shift_id=${requestRow.shift_id}::uuid AND staff_id=${requestRow.requester_id}::uuid AND EXISTS (SELECT 1 FROM eligible) RETURNING id
        ), removed_recipient AS (
          DELETE FROM shift_assignments WHERE shift_id=${requestRow.recipient_shift_id}::uuid AND staff_id=${requestRow.recipient_id}::uuid AND EXISTS (SELECT 1 FROM eligible) RETURNING id
        ), assigned_recipient AS (
          INSERT INTO shift_assignments (shift_id, staff_id, assigned_by)
          SELECT ${requestRow.shift_id}::uuid, ${requestRow.recipient_id}::uuid, ${manager.id}::uuid
          WHERE EXISTS (SELECT 1 FROM removed_requester) AND EXISTS (SELECT 1 FROM removed_recipient) RETURNING id
        ), assigned_requester AS (
          INSERT INTO shift_assignments (shift_id, staff_id, assigned_by)
          SELECT ${requestRow.recipient_shift_id}::uuid, ${requestRow.requester_id}::uuid, ${manager.id}::uuid
          WHERE EXISTS (SELECT 1 FROM assigned_recipient) RETURNING id
        )
        UPDATE swap_requests SET status='approved', reviewed_by=${manager.id}::uuid, reviewed_at=now()
        WHERE id=${id}::uuid AND EXISTS (SELECT 1 FROM assigned_requester) RETURNING id`;
      if (!finalized[0]) return NextResponse.json({ error: "One of the assignments changed. The exchange was not finalized." }, { status: 409 });
      return NextResponse.json({ ok: true, message: "Shift exchange approved and finalized." });
    }
    await sql`UPDATE swap_requests SET status='declined', reviewed_by=${manager.id}, reviewed_at=now() WHERE id=${id}::uuid`;
    return NextResponse.json({ ok: true, message: "Shift exchange declined." });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to review request" }, { status: 403 }); }
}
