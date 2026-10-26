import { NextResponse } from "next/server";
import { requireViewer } from "@/lib/auth";
import { database } from "@/lib/db";
import { deliverRequestEmail } from "@/lib/deliver-request-email";
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await requireViewer(); const { id } = await params; const sql = database();
    const rows = await sql`SELECT id FROM swap_requests WHERE id=${id}::uuid AND status='pending' AND (requester_id=${viewer.id}::uuid OR ${viewer.role === "manager"})`;
    if (!rows[0]) return NextResponse.json({ error: "Request unavailable." }, { status: 404 });
    const sent = await deliverRequestEmail(id);
    return NextResponse.json(sent ? { ok: true, message: "Request email sent." } : { error: "Email could not be sent. The request is still available in the employee’s app. Please retry later." }, { status: sent ? 200 : 502 });
  } catch { return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 }); }
}
