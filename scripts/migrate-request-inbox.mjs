import { neon } from "@neondatabase/serverless";
if (process.env.DATABASE_URL) {
  const sql = neon(process.env.DATABASE_URL);
  await sql`ALTER TABLE swap_requests ADD COLUMN IF NOT EXISTS manager_dismissed_at TIMESTAMPTZ`;
  console.log("Request inbox schema ready; existing requests preserved.");
}
