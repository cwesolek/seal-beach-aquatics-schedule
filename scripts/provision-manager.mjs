import { neon } from "@neondatabase/serverless";

// Opt-in administrator provisioning. The account data and service credentials
// stay in Vercel environment variables and are never logged or bundled.
if (!process.env.MANAGER_ACCOUNT_SETUP) {
  console.log("No manager account setup requested.");
} else {
  const { email, firstName, lastName } = JSON.parse(process.env.MANAGER_ACCOUNT_SETUP);
  if (!email || !firstName || !lastName) throw new Error("Incomplete manager account setup.");
  if (!process.env.CLERK_SECRET_KEY || !process.env.DATABASE_URL) throw new Error("Account services are not configured.");
  const api = async (path, method = "GET", body) => {
    const response = await fetch(`https://api.clerk.com/v1${path}`, {
      method, headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(`Account setup failed (${response.status}): ${result.errors?.map(e => `${e.code}: ${e.message}`).join("; ") || "Authentication service error"}`);
    return result;
  };
  const encodedHost = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.split("_").slice(2).join("_");
  if (!encodedHost) throw new Error("The public authentication configuration is missing.");
  const host = Buffer.from(encodedHost, "base64").toString().replace(/\$$/, "");
  const environmentResponse = await fetch(`https://${host}/v1/environment`);
  if (!environmentResponse.ok) throw new Error("Unable to verify email-code sign-in settings.");
  const environment = await environmentResponse.json();
  const attributes = (environment.response?.user_settings ?? environment.user_settings).attributes;
  if (!attributes.email_address.first_factors.includes("email_code")) throw new Error("Enable email-code sign-in before provisioning this passwordless account.");
  const names = {
    ...(attributes.first_name.enabled ? { first_name: firstName } : {}),
    ...(attributes.last_name.enabled ? { last_name: lastName } : {}),
  };
  const matches = await api(`/users?email_address=${encodeURIComponent(email.toLowerCase())}&limit=2`);
  if (matches.length > 1) throw new Error("More than one matching account; manual review required.");
  let user = matches[0];
  if (!user) user = await api("/users", "POST", {
    email_address: [email.toLowerCase()], ...names,
    skip_password_requirement: true, public_metadata: { role: "manager" },
  });
  else user = await api(`/users/${user.id}`, "PATCH", {
    ...names,
    public_metadata: { ...user.public_metadata, role: "manager" },
  });
  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql`INSERT INTO staff (clerk_user_id,name,first_name,last_name,email,role,active,approval_status)
    VALUES (${user.id},${`${firstName} ${lastName}`},${firstName},${lastName},${email.toLowerCase()},'manager',true,'approved')
    ON CONFLICT (email) DO UPDATE SET clerk_user_id=EXCLUDED.clerk_user_id,name=EXCLUDED.name,
      first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,role='manager',active=true,approval_status='approved'
    RETURNING role,active,approval_status`;
  console.log("MANAGER_ACCOUNT_READY", JSON.stringify({ ...rows[0], passwordEnabled: user.password_enabled }));
}
