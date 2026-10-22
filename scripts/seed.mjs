import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const sql = neon(process.env.DATABASE_URL);
const templates = [
  [1, "Morning", "05:45", "10:45"], [1, "Midday", "10:45", "15:15"], [1, "Aquatics class", "14:45", "16:15"], [1, "Evening", "18:45", "21:15"],
  [2, "Morning", "05:45", "10:45"], [2, "Midday", "10:45", "15:15"], [2, "Aquatics class", "14:45", "16:15"], [2, "Evening", "18:45", "21:15"],
  [3, "Morning", "05:45", "10:45"], [3, "Midday", "10:45", "15:15"], [3, "Aquatics class", "14:45", "16:15"], [3, "Evening", "18:45", "21:15"],
  [4, "Morning", "05:45", "10:45"], [4, "Midday", "10:45", "15:15"], [4, "Aquatics class", "14:45", "16:15"], [4, "Evening", "18:45", "21:15"],
  [5, "Morning", "05:45", "10:45"], [5, "Midday", "10:45", "15:15"],
  [6, "Weekend", "07:45", "12:15"], [0, "Weekend", "07:45", "12:15"],
];
for (const [day, title, startsAt, endsAt] of templates) {
  await sql`INSERT INTO recurring_shift_templates (day_of_week, title, starts_at, ends_at, required_staff) SELECT ${day}, ${title}, ${startsAt}::time, ${endsAt}::time, 2 WHERE NOT EXISTS (SELECT 1 FROM recurring_shift_templates WHERE day_of_week=${day} AND title=${title} AND starts_at=${startsAt}::time)`;
}
await sql`UPDATE shifts SET template_id=NULL WHERE template_id IN (SELECT id FROM recurring_shift_templates WHERE day_of_week=5 AND title='Evening')`;
await sql`UPDATE recurring_shift_templates SET active=false WHERE day_of_week=5 AND title='Evening'`;
await sql`DELETE FROM shifts WHERE shift_date>=CURRENT_DATE AND template_id IN (SELECT id FROM recurring_shift_templates WHERE day_of_week=5 AND title='Aquatics class')`;
await sql`UPDATE recurring_shift_templates SET active=false WHERE day_of_week=5 AND title='Aquatics class'`;
await sql`UPDATE recurring_shift_templates SET required_staff=2 WHERE active=true`;
await sql`UPDATE shifts SET required_staff=2 WHERE template_id IS NOT NULL AND title!='Aquatics class' AND status != 'cancelled'`;
console.log("Recurring shift templates seeded.");
