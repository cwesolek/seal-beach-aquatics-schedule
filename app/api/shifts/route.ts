import { NextResponse } from "next/server";
import { database } from "@/lib/db";
import { requireManager } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const manager = await requireManager();
    const body = await request.json() as { date?: string; title?: string; startsAt?: string; endsAt?: string; staffId?: string };
    if (!body.date || !body.title || !body.startsAt || !body.endsAt) return NextResponse.json({ error: "Date, title, start, and end are required." }, { status: 400 });
    const sql = database();
    const created = await sql`INSERT INTO shifts (shift_date, title, starts_at, ends_at, status, created_by) VALUES (${body.date}::date, ${body.title.trim()}, ${body.startsAt}::time, ${body.endsAt}::time, ${body.staffId ? 'assigned' : 'open'}, ${manager.id}) RETURNING id`;
    if (body.staffId) await sql`INSERT INTO shift_assignments (shift_id, staff_id, assigned_by) VALUES (${created[0].id}, ${body.staffId}::uuid, ${manager.id})`;
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create shift" }, { status: 403 }); }
}
