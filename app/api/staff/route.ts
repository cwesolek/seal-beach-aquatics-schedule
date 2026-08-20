import { NextResponse } from "next/server";
import { database, hasDatabase } from "@/lib/db";
import { requireManager, requireViewer } from "@/lib/auth";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not update the directory.";
}

export async function PATCH(request: Request) {
  if (!hasDatabase()) return NextResponse.json({ error: "Preview mode: sign in to save this change." }, { status: 401 });
  try {
    const viewer = await requireViewer();
    const body = await request.json() as { action?: string; name?: string; phone?: string; staffId?: string };
    const sql = database();

    if (body.action === "updateProfile") {
      const name = body.name?.trim().replace(/\s+/g, " ") ?? "";
      const phone = body.phone?.trim() ?? "";
      if (!name) return NextResponse.json({ error: "Add the name you want your team to see." }, { status: 400 });
      if (name.length > 80) return NextResponse.json({ error: "Please use a shorter displayed name." }, { status: 400 });
      if (!phone) return NextResponse.json({ error: "Add a phone number so your team can reach you." }, { status: 400 });
      if (phone.length > 40) return NextResponse.json({ error: "Please use a shorter phone number." }, { status: 400 });
      await sql`UPDATE staff SET name = ${name}, phone = ${phone} WHERE id = ${viewer.id}`;
      return NextResponse.json({ ok: true, message: "Your profile was saved." });
    }

    if (body.action === "deactivate") {
      const manager = await requireManager();
      const staffId = body.staffId?.trim();
      if (!staffId) return NextResponse.json({ error: "Choose an employee to remove." }, { status: 400 });
      const result = await sql`
        UPDATE staff SET active = false
        WHERE id = ${staffId} AND id <> ${manager.id} AND role = 'staff' AND active = true
        RETURNING id`;
      if (!result.length) return NextResponse.json({ error: "That employee is unavailable or cannot be removed here." }, { status: 404 });
      return NextResponse.json({ ok: true, message: "Employee removed from the active directory." });
    }

    return NextResponse.json({ error: "Unknown directory action." }, { status: 400 });
  } catch (error) {
    const message = errorMessage(error);
    const status = message.includes("Manager access") ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
