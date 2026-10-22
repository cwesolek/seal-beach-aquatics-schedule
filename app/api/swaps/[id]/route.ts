import { NextResponse } from "next/server";
import { database } from "@/lib/db";
import { requireViewer } from "@/lib/auth";
import { acceptanceQueries } from "@/lib/swap-acceptance";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await requireViewer();
    const { id } = await params;
    const { action } = await request.json() as { action?: string };
    if (action !== "accept" && action !== "decline") return NextResponse.json({ error: "Choose accept or decline." }, { status: 400 });
    const sql = database();
    if (action === "accept") {
      const results = await sql.transaction(acceptanceQueries(sql, id, viewer.id));
      if (!results[1].length) return NextResponse.json({ error: "This request cannot be accepted. It may already be resolved, belong to another staff member, or its assignments have changed." }, { status: 409 });
      return NextResponse.json({ ok: true, message: "Accepted. The schedule has been updated." });
    }
    const rows = await sql`UPDATE swap_requests SET status='declined', reviewed_by=${viewer.id}::uuid, reviewed_at=now()
      WHERE id=${id}::uuid AND status='pending' AND (recipient_id=${viewer.id}::uuid OR ${viewer.role === "manager"}) RETURNING id`;
    if (!rows.length) return NextResponse.json({ error: "This request is no longer available or cannot be declined by you." }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update request" }, { status: 403 }); }
}
