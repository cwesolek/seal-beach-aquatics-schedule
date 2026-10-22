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
    const body = await request.json() as { action?: string; firstName?: string; lastName?: string; phone?: string; staffId?: string };
    const sql = database();

    if (body.action === "approveProfile" || body.action === "rejectProfile") {
      const manager = await requireManager();
      const staffId = body.staffId?.trim();
      if (!staffId) return NextResponse.json({ error: "Choose a profile to review." }, { status: 400 });
      const approvalStatus = body.action === "approveProfile" ? "approved" : "rejected";
      const result = await sql`UPDATE staff SET approval_status=${approvalStatus} WHERE id=${staffId}::uuid AND id<>${manager.id} AND role='staff' AND approval_status='pending' RETURNING id`;
      if (!result[0]) return NextResponse.json({ error: "That profile has already been reviewed or is unavailable." }, { status: 404 });
      return NextResponse.json({ ok: true, message: approvalStatus === "approved" ? "Staff profile approved." : "Profile access rejected." });
    }

    if (body.action === "updateProfile") {
      const firstName = body.firstName?.trim().replace(/\s+/g, " ") ?? "";
      const lastName = body.lastName?.trim().replace(/\s+/g, " ") ?? "";
      const name = `${firstName} ${lastName}`.trim();
      const phone = body.phone?.trim() ?? "";
      if (!firstName || !lastName) return NextResponse.json({ error: "Add both your first and last name." }, { status: 400 });
      if (firstName.length > 50 || lastName.length > 50) return NextResponse.json({ error: "Please use shorter first and last names." }, { status: 400 });
      if (!phone) return NextResponse.json({ error: "Add a phone number so your team can reach you." }, { status: 400 });
      if (phone.length > 40) return NextResponse.json({ error: "Please use a shorter phone number." }, { status: 400 });
      await sql`UPDATE staff SET name=${name}, first_name=${firstName}, last_name=${lastName}, phone=${phone} WHERE id=${viewer.id}`;
      return NextResponse.json({ ok: true, message: "Your profile was saved." });
    }

    if (body.action === "updateStaffName") {
      await requireManager();
      const staffId = body.staffId?.trim();
      const firstName = body.firstName?.trim().replace(/\s+/g, " ") ?? "";
      const lastName = body.lastName?.trim().replace(/\s+/g, " ") ?? "";
      if (!staffId) return NextResponse.json({ error: "Choose a staff member to update." }, { status: 400 });
      if (!firstName || !lastName) return NextResponse.json({ error: "Add both the staff member's first and last name." }, { status: 400 });
      if (firstName.length > 50 || lastName.length > 50) return NextResponse.json({ error: "Please use shorter first and last names." }, { status: 400 });
      const name = `${firstName} ${lastName}`;
      const updated = await sql`UPDATE staff SET name=${name}, first_name=${firstName}, last_name=${lastName} WHERE id=${staffId}::uuid AND role='staff' AND active=true RETURNING id`;
      if (!updated[0]) return NextResponse.json({ error: "That active staff profile could not be updated." }, { status: 404 });
      return NextResponse.json({ ok: true, message: `${name}'s name was updated.` });
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
