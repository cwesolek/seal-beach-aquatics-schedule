import { NextResponse } from "next/server";
import { database } from "@/lib/db";
import { requireManager, requireViewer } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer(); const body = await request.json() as { startsOn?: string; endsOn?: string; status?: string; note?: string };
    if (!body.startsOn || !body.endsOn) return NextResponse.json({ error: "Start and end dates are required." }, { status: 400 });
    await database()`INSERT INTO availability (staff_id, starts_on, ends_on, status, note) VALUES (${viewer.id}, ${body.startsOn}::date, ${body.endsOn}::date, ${body.status ?? 'unavailable'}, ${body.note?.trim() || null})`;
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save availability" }, { status: 401 }); }
}

export async function DELETE(request: Request) {
  try {
    await requireManager();
    const body = await request.json() as { availabilityId?: string };
    if (!body.availabilityId) return NextResponse.json({ error: "Choose an availability note to delete." }, { status: 400 });
    const removed = await database()`DELETE FROM availability WHERE id=${body.availabilityId}::uuid RETURNING id`;
    if (!removed[0]) return NextResponse.json({ error: "That availability note no longer exists." }, { status: 404 });
    return NextResponse.json({ ok: true, message: "Availability note deleted." });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to delete availability" }, { status: 403 }); }
}
