import type { database } from "./db";

// Every acceptance locks the request, its shifts, and their assignments in the
// same order. Transfer and one-day recurring exclusions commit together.
export function finalizeSwapQueries(sql: ReturnType<typeof database>, id: string, viewerId: string) {
  return [
    sql`SELECT id FROM swap_requests WHERE id=${id}::uuid FOR UPDATE`,
    sql`SELECT id FROM shifts WHERE id IN (
      SELECT shift_id FROM swap_requests WHERE id=${id}::uuid
      UNION SELECT recipient_shift_id FROM swap_requests WHERE id=${id}::uuid
      UNION SELECT additional_shift_id FROM swap_requests WHERE id=${id}::uuid
    ) ORDER BY id FOR UPDATE`,
    sql`SELECT id FROM shift_assignments WHERE shift_id IN (
      SELECT shift_id FROM swap_requests WHERE id=${id}::uuid
      UNION SELECT recipient_shift_id FROM swap_requests WHERE id=${id}::uuid
      UNION SELECT additional_shift_id FROM swap_requests WHERE id=${id}::uuid
    ) ORDER BY id FOR UPDATE`,
    sql`WITH eligible AS MATERIALIZED (
      SELECT r.* FROM swap_requests r
      JOIN staff recipient ON recipient.id=r.recipient_id AND recipient.active=true AND recipient.approval_status='approved'
      JOIN shifts source ON source.id=r.shift_id AND source.status IN ('open','assigned')
      WHERE r.id=${id}::uuid AND r.status='pending' AND r.recipient_id=${viewerId}::uuid AND r.requester_id<>r.recipient_id
        AND NOT (r.recipient_shift_id IS NOT NULL AND r.additional_shift_id IS NOT NULL)
        AND EXISTS (SELECT 1 FROM shift_assignments WHERE shift_id=r.shift_id AND staff_id=r.requester_id)
        AND NOT EXISTS (SELECT 1 FROM shift_assignments WHERE shift_id=r.shift_id AND staff_id=r.recipient_id)
        AND (r.recipient_shift_id IS NULL OR (
          r.recipient_shift_id<>r.shift_id
          AND EXISTS (SELECT 1 FROM shift_assignments a JOIN shifts s ON s.id=a.shift_id
            WHERE a.shift_id=r.recipient_shift_id AND a.staff_id=r.recipient_id AND s.status IN ('open','assigned'))
          AND NOT EXISTS (SELECT 1 FROM shift_assignments WHERE shift_id=r.recipient_shift_id AND staff_id=r.requester_id)
        ))
        AND (r.additional_shift_id IS NULL OR (
          r.additional_shift_id<>r.shift_id
          AND EXISTS (SELECT 1 FROM shift_assignments a JOIN shifts s ON s.id=a.shift_id
            WHERE a.shift_id=r.additional_shift_id AND a.staff_id=r.requester_id AND s.status IN ('open','assigned'))
          AND NOT EXISTS (SELECT 1 FROM shift_assignments WHERE shift_id=r.additional_shift_id AND staff_id=r.recipient_id)
        ))
    ), transferred AS (
      UPDATE shift_assignments a SET staff_id=CASE WHEN a.shift_id=r.recipient_shift_id THEN r.requester_id ELSE r.recipient_id END,
        assigned_by=${viewerId}::uuid, actual_starts_at=NULL, actual_ends_at=NULL
      FROM eligible r WHERE (a.shift_id IN (r.shift_id,r.additional_shift_id) AND a.staff_id=r.requester_id)
        OR (a.shift_id=r.recipient_shift_id AND a.staff_id=r.recipient_id)
      RETURNING a.shift_id, CASE WHEN a.shift_id=r.recipient_shift_id THEN r.recipient_id ELSE r.requester_id END AS outgoing_staff_id
    ), excluded AS (
      INSERT INTO recurring_assignment_exclusions (template_id,staff_id,shift_date,created_by)
      SELECT s.template_id,t.outgoing_staff_id,s.shift_date,${viewerId}::uuid
      FROM transferred t JOIN shifts s ON s.id=t.shift_id WHERE s.template_id IS NOT NULL
      ON CONFLICT (template_id,staff_id,shift_date) DO NOTHING RETURNING staff_id
    )
    UPDATE swap_requests r SET manager_dismissed_at=NULL,status='approved',recipient_accepted_at=now(),reviewed_by=${viewerId}::uuid,reviewed_at=now()
    FROM eligible e WHERE r.id=e.id AND (SELECT count(*) FROM transferred)=
      CASE WHEN e.recipient_shift_id IS NULL AND e.additional_shift_id IS NULL THEN 1 ELSE 2 END
    RETURNING r.id`,
    sql`UPDATE timesheet_entries entry SET hours=COALESCE((
      SELECT ROUND(SUM(EXTRACT(epoch FROM (upper(merged.slot)-lower(merged.slot)))) / 3600 * 2) / 2
      FROM (
        SELECT range_agg(tsrange(s.shift_date + CASE WHEN a.actual_starts_at IS NOT NULL AND a.actual_ends_at IS NOT NULL THEN a.actual_starts_at ELSE COALESCE(a.scheduled_starts_at,s.starts_at) END,
          s.shift_date + CASE WHEN a.actual_starts_at IS NOT NULL AND a.actual_ends_at IS NOT NULL THEN a.actual_ends_at ELSE COALESCE(a.scheduled_ends_at,s.ends_at) END,'[)')) AS slots
        FROM shift_assignments a JOIN shifts s ON s.id=a.shift_id
        WHERE a.staff_id=entry.staff_id AND to_char(s.shift_date,'YYYY-MM-DD')=entry.entry_key AND s.status<>'cancelled'
      ) ranges CROSS JOIN LATERAL unnest(ranges.slots) merged(slot)
    ),0)
    FROM swap_requests r WHERE r.id=${id}::uuid AND r.status='approved' AND r.reviewed_at=now() AND r.reviewed_by=${viewerId}::uuid
      AND entry.staff_id IN (r.requester_id,r.recipient_id) AND entry.row_type='regular'
      AND EXISTS (SELECT 1 FROM shifts s WHERE s.id IN (r.shift_id,r.recipient_shift_id,r.additional_shift_id)
        AND entry.entry_key=to_char(s.shift_date,'YYYY-MM-DD') AND s.shift_date BETWEEN entry.period_start AND entry.period_start+13)`,
  ];
}
