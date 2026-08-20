import { NextResponse } from "next/server";
import { database } from "@/lib/db";
import { requireViewer } from "@/lib/auth";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await requireViewer(); const { id } = await params;
    await database()`INSERT INTO open_shift_claims (shift_id, staff_id) VALUES (${id}::uuid, ${viewer.id}) ON CONFLICT (shift_id, staff_id) DO NOTHING`;
    return NextResponse.json({ ok: true, message: "Claim sent to managers for approval." });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to claim shift" }, { status: 401 }); }
}
