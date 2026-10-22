import { NextResponse } from "next/server";
import { database } from "@/lib/db";
import { requireViewer } from "@/lib/auth";
import { finalizeSwapQueries } from "@/lib/finalize-swap";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await requireViewer();
    const { id } = await params;
    const sql = database();
    const results = await sql.transaction(finalizeSwapQueries(sql, id, viewer.id));
    if (!results[3].length) return NextResponse.json({ error: "This request is no longer available to accept, or one of its assignments has changed." }, { status: 409 });
    return NextResponse.json({ ok: true, message: "Accepted and finalized. The schedule has been updated and the pending request cleared." });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to accept swap" }, { status: 403 }); }
}
