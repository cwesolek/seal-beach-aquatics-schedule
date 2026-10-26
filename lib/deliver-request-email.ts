import { database } from "@/lib/db";
import { sendRequestEmail, type RequestEmail } from "@/lib/request-email";

export async function deliverRequestEmail(id: string): Promise<boolean> {
  const sql = database();
  const rows = await sql`SELECT sr.id, recipient.email AS "to", recipient.name AS recipient, requester.name AS requester, sr.email_sent_at AS "emailSentAt", s.title || ' · ' || to_char(s.shift_date,'Mon DD, YYYY') || ' · ' || to_char(COALESCE(a.scheduled_starts_at,s.starts_at),'HH24:MI') || '–' || to_char(COALESCE(a.scheduled_ends_at,s.ends_at),'HH24:MI') AS shift, rs.title || ' · ' || to_char(rs.shift_date,'Mon DD, YYYY') || ' · ' || to_char(COALESCE(ra.scheduled_starts_at,rs.starts_at),'HH24:MI') || '–' || to_char(COALESCE(ra.scheduled_ends_at,rs.ends_at),'HH24:MI') AS "recipientShift", extra.title || ' · ' || to_char(extra.shift_date,'Mon DD, YYYY') || ' · ' || to_char(COALESCE(ea.scheduled_starts_at,extra.starts_at),'HH24:MI') || '–' || to_char(COALESCE(ea.scheduled_ends_at,extra.ends_at),'HH24:MI') AS "additionalShift" FROM swap_requests sr JOIN staff recipient ON recipient.id=sr.recipient_id JOIN staff requester ON requester.id=sr.requester_id JOIN shifts s ON s.id=sr.shift_id LEFT JOIN shifts rs ON rs.id=sr.recipient_shift_id LEFT JOIN shifts extra ON extra.id=sr.additional_shift_id LEFT JOIN shift_assignments a ON a.shift_id=s.id AND a.staff_id=sr.requester_id LEFT JOIN shift_assignments ra ON ra.shift_id=rs.id AND ra.staff_id=sr.recipient_id LEFT JOIN shift_assignments ea ON ea.shift_id=extra.id AND ea.staff_id=sr.requester_id WHERE sr.id=${id}::uuid AND sr.status='pending'`;
  if (!rows[0]) return false;
  if (rows[0].emailSentAt) return true;
  try {
    const emailId = await sendRequestEmail(rows[0] as RequestEmail);
    await sql`UPDATE swap_requests SET email_sent_at=now(), email_provider_id=${emailId}, email_failed_at=NULL WHERE id=${id}::uuid`;
    return true;
  } catch {
    await sql`UPDATE swap_requests SET email_failed_at=now() WHERE id=${id}::uuid AND email_sent_at IS NULL`;
    return false;
  }
}
