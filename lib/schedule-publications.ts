import type { database } from "./db";
type Sql = ReturnType<typeof database>;
export function postScheduleQueries(sql: Sql, start: string, end: string, viewerId: string) {
  return [
    sql`INSERT INTO schedule_publications (period_start,period_end,posted_by) SELECT ${start}::date,${end}::date,${viewerId}::uuid WHERE EXISTS (SELECT 1 FROM shifts WHERE shift_date BETWEEN ${start}::date AND ${end}::date AND status<>'cancelled') ON CONFLICT (period_start) DO NOTHING RETURNING id`,
    sql`INSERT INTO schedule_publication_emails (publication_id,staff_id,recipient_email,batch_number) SELECT p.id,s.id,s.email,((row_number() OVER (ORDER BY s.id)-1)/100)::int FROM schedule_publications p CROSS JOIN staff s WHERE p.period_start=${start}::date AND p.posted_at=now() AND s.active=true AND s.approval_status='approved' ON CONFLICT DO NOTHING`,
    sql`SELECT id,to_char(period_start,'YYYY-MM-DD') AS "periodStart",to_char(period_end,'YYYY-MM-DD') AS "periodEnd",posted_at AS "postedAt" FROM schedule_publications WHERE period_start=${start}::date`,
  ];
}
export async function publicationDeliveryCounts(sql: Sql, id: string) {
  const rows = await sql`SELECT count(*)::int AS total,count(sent_at)::int AS sent FROM schedule_publication_emails WHERE publication_id=${id}::uuid`;
  return rows[0] as {total:number;sent:number};
}
