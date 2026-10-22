import type { database } from "./db";

// Lock both shifts in a stable order before checking assignments. Concurrent
// acceptances therefore see the assignments committed by the previous request.
export function acceptanceQueries(sql: ReturnType<typeof database>, id: string, staffId: string) {
  return [
    sql`SELECT id FROM shifts WHERE id IN (
      SELECT shift_id FROM swap_requests WHERE id=${id}::uuid
      UNION SELECT target_shift_id FROM swap_requests WHERE id=${id}::uuid
    ) ORDER BY id FOR UPDATE`,
    sql`WITH eligible AS MATERIALIZED (
      SELECT r.* FROM swap_requests r
      JOIN shifts s ON s.id=r.shift_id
      JOIN staff recipient ON recipient.id=${staffId}::uuid AND recipient.active=true
      WHERE r.id=${id}::uuid AND r.status='pending'
        AND r.requester_id<>${staffId}::uuid
        AND (r.recipient_id IS NULL OR r.recipient_id=${staffId}::uuid)
        AND s.status IN ('open', 'assigned') AND s.shift_date>=CURRENT_DATE
        AND EXISTS (SELECT 1 FROM shift_assignments WHERE shift_id=r.shift_id AND staff_id=r.requester_id)
        AND NOT EXISTS (SELECT 1 FROM shift_assignments WHERE shift_id=r.shift_id AND staff_id=${staffId}::uuid)
        AND (r.target_shift_id IS NULL OR (
          r.target_shift_id<>r.shift_id
          AND EXISTS (SELECT 1 FROM shifts t JOIN shift_assignments a ON a.shift_id=t.id
            WHERE t.id=r.target_shift_id AND a.staff_id=${staffId}::uuid
              AND t.status IN ('open', 'assigned') AND t.shift_date>=CURRENT_DATE)
          AND NOT EXISTS (SELECT 1 FROM shift_assignments WHERE shift_id=r.target_shift_id AND staff_id=r.requester_id)
        ))
      FOR UPDATE OF r
    ), transferred AS (
      UPDATE shift_assignments a SET staff_id=CASE WHEN a.shift_id=r.shift_id THEN ${staffId}::uuid ELSE r.requester_id END,
        assigned_by=${staffId}::uuid
      FROM eligible r WHERE (a.shift_id=r.shift_id AND a.staff_id=r.requester_id)
        OR (a.shift_id=r.target_shift_id AND a.staff_id=${staffId}::uuid)
      RETURNING a.id
    )
    UPDATE swap_requests r SET status='approved', recipient_id=${staffId}::uuid,
      reviewed_by=${staffId}::uuid, reviewed_at=now()
    FROM eligible e WHERE r.id=e.id
      AND (SELECT COUNT(*) FROM transferred)=CASE WHEN e.target_shift_id IS NULL THEN 1 ELSE 2 END
    RETURNING r.id`,
  ];
}
