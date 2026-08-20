import { auth, currentUser } from "@clerk/nextjs/server";
import { database } from "@/lib/db";

export type Viewer = { id: string; name: string; email: string; phone: string | null; role: "manager" | "staff" };

export async function requireViewer(): Promise<Viewer> {
  const { userId } = await auth();
  if (!userId) throw new Error("Please sign in to continue.");
  const clerkUser = await currentUser();
  const email = clerkUser?.primaryEmailAddress?.emailAddress?.toLowerCase();
  if (!email) throw new Error("Your account needs an email address.");
  const managerEmails = (process.env.MANAGER_EMAILS ?? "")
    .split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  const role: Viewer["role"] = managerEmails.includes(email) ? "manager" : "staff";
  const name = [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(" ") || email.split("@")[0];
  const sql = database();
  const rows = await sql`
    INSERT INTO staff (clerk_user_id, name, email, role, active)
    VALUES (${userId}, ${name}, ${email}, ${role}, true)
    ON CONFLICT (clerk_user_id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role
    RETURNING id, name, email, phone, role, active`;
  const member = rows[0] as Viewer & { active: boolean };
  if (!member.active) throw new Error("Your staff account is no longer active. Please contact a manager.");
  return member;
}

export async function requireManager() {
  const viewer = await requireViewer();
  if (viewer.role !== "manager") throw new Error("Manager access is required.");
  return viewer;
}
