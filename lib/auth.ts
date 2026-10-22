import { auth, currentUser } from "@clerk/nextjs/server";
import { database } from "@/lib/db";

export type Viewer = { id: string; name: string; firstName: string; lastName: string; email: string; phone: string | null; role: "manager" | "staff" };

export class ApprovalRequiredError extends Error {
  constructor(public viewer: Pick<Viewer, "name" | "email">, public rejected = false) {
    super(rejected ? "Your access request was not approved. Please contact a manager." : "Your profile is waiting for manager approval.");
    this.name = "ApprovalRequiredError";
  }
}

export async function requireViewer(): Promise<Viewer> {
  const { userId } = await auth();
  if (!userId) throw new Error("Please sign in to continue.");
  const clerkUser = await currentUser();
  const email = clerkUser?.primaryEmailAddress?.emailAddress?.toLowerCase();
  if (!email) throw new Error("Your account needs an email address.");
  const managerEmails = (process.env.MANAGER_EMAILS ?? "")
    .split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  const role: Viewer["role"] = managerEmails.includes(email) ? "manager" : "staff";
  const firstName = clerkUser?.firstName?.trim() || email.split("@")[0];
  const lastName = clerkUser?.lastName?.trim() || "";
  const name = [firstName, lastName].filter(Boolean).join(" ");
  const sql = database();
  const matching = await sql`SELECT id, clerk_user_id FROM staff WHERE clerk_user_id=${userId} OR email=${email} ORDER BY (clerk_user_id=${userId}) DESC LIMIT 1`;
  const rows = matching[0]
    ? await sql`UPDATE staff SET clerk_user_id=${userId}, email=${email}, role=${role}, approval_status=CASE WHEN ${role}='manager' THEN 'approved' ELSE approval_status END WHERE id=${matching[0].id} RETURNING id, name, first_name AS "firstName", last_name AS "lastName", email, phone, role, active, approval_status AS "approvalStatus"`
    : await sql`INSERT INTO staff (clerk_user_id, name, first_name, last_name, email, role, active, approval_status) VALUES (${userId}, ${name}, ${firstName}, ${lastName}, ${email}, ${role}, true, ${role === "manager" ? "approved" : "pending"}) RETURNING id, name, first_name AS "firstName", last_name AS "lastName", email, phone, role, active, approval_status AS "approvalStatus"`;
  const member = rows[0] as Viewer & { active: boolean; approvalStatus: "pending" | "approved" | "rejected" };
  if (!member.active) throw new Error("Your staff account is no longer active. Please contact a manager.");
  if (member.approvalStatus !== "approved") throw new ApprovalRequiredError({ name: member.name, email: member.email }, member.approvalStatus === "rejected");
  return member;
}

export async function requireManager() {
  const viewer = await requireViewer();
  if (viewer.role !== "manager") throw new Error("Manager access is required.");
  return viewer;
}
