import { neon } from "@neondatabase/serverless";

// Read-only verification: log counts and fingerprints, never staff details.
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for schedule verification.");
const sql = neon(process.env.DATABASE_URL);
const tables = ["shifts", "shift_assignments", "recurring_staff_assignments", "recurring_assignment_exclusions", "recurring_shift_templates", "pay_period_settings", "timesheet_entries"];
const query = tables.map(table => `SELECT '${table}' AS table_name, count(*)::int AS count, md5(COALESCE(string_agg(to_jsonb(t)::text, '' ORDER BY to_jsonb(t)::text), '')) AS fingerprint FROM ${table} t`).join(" UNION ALL ");
const results = await sql.transaction([sql.query(query)], { readOnly: true });
console.log("SCHEDULE_INTEGRITY", JSON.stringify(results[0]));
