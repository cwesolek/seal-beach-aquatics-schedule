import { neon } from "@neondatabase/serverless";

// Additive and safe to repeat; old app versions do not depend on this column.
// Vercel supplies DATABASE_URL to the build without exporting its credentials.
if (process.env.DATABASE_URL) {
  const sql = neon(process.env.DATABASE_URL);
  await sql`ALTER TABLE swap_requests ADD COLUMN IF NOT EXISTS target_shift_id UUID REFERENCES shifts(id) ON DELETE CASCADE`;
  console.log("Cover/swap schema is ready.");
} else {
  console.log("No database configured; skipping cover/swap migration for the local/demo build.");
}
