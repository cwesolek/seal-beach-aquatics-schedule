import { NextResponse } from "next/server";
import { database } from "@/lib/db";
import { requireManager } from "@/lib/auth";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const manager = await requireManager();
    const { id } = await params;
    const { action } = await request.json();
    if (action !== "decline") return NextResponse.json({ error: "The selected employee must accept to finalize this request." }, { status: 400 });
    const sql = database();
    const rows = await sql`UPDATE swap_requests SET status='declined',reviewed_by=${manager.id}::uuid,reviewed_at=now() WHERE id=${id}::uuid AND status='pending' RETURNING id`;
    if (!rows.length) return NextResponse.json({ error: "This request is no longer pending." }, { status: 409 });
    return NextResponse.json({ ok: true, message: "Request declined." });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to review request" }, { status: 403 }); }
}

// Delete the manager message, not the request or its schedule history.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireManager();
    const { id } = await params;
    const sql = database();
    const rows = await sql`UPDATE swap_requests SET manager_dismissed_at=now() WHERE id=${id}::uuid RETURNING id`;
    if (!rows.length) return NextResponse.json({ error: "Message not found." }, { status: 404 });
    return NextResponse.json({ ok: true, message: "Message deleted." });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to delete message" }, { status: 403 }); }
}
