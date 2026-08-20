import { NextResponse } from "next/server";
import { database } from "@/lib/db";
import { requireViewer } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer(); const body = await request.json() as { startsOn?: string; endsOn?: string; status?: string; note?: string };
    if (!body.startsOn || !body.endsOn) return NextResponse.json({ error: "Start and end dates are required." }, { status: 400 });
    await database()`INSERT INTO availability (staff_id, starts_on, ends_on, status, note) VALUES (${viewer.id}, ${body.startsOn}::date, ${body.endsOn}::date, ${body.status ?? 'unavailable'}, ${body.note?.trim() || null})`;
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save availability" }, { status: 401 }); }
}
