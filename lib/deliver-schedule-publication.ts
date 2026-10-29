import type { database } from "./db";
import { sendPublicationBatch, type Publication } from "./schedule-publication-email";
export async function deliverSchedulePublication(sql: ReturnType<typeof database>, publication: Publication, send = sendPublicationBatch) {
  const lock=await sql`UPDATE schedule_publications SET sending_until=now()+interval '90 seconds' WHERE id=${publication.id}::uuid AND (sending_until IS NULL OR sending_until<now()) RETURNING id`;
  if (!lock.length) return;
  try {
    const pending=await sql`SELECT batch_number AS "batchNumber",staff_id::text AS "staffId",recipient_email AS email FROM schedule_publication_emails WHERE publication_id=${publication.id}::uuid AND sent_at IS NULL ORDER BY batch_number,staff_id`;
    const batches = [...new Set(pending.map(row=>row.batchNumber as number))];
    for (const [index,batchNumber] of batches.entries()) {
      // Keep each batch within the provider's request rate limit.
      if (index) await new Promise(resolve=>setTimeout(resolve,600));
      const recipients=pending.filter(row=>row.batchNumber===batchNumber) as {batchNumber:number;staffId:string;email:string}[];
      try {
        const ids=await send(publication,batchNumber,recipients);
        await sql.transaction(recipients.map((recipient,i)=>sql`UPDATE schedule_publication_emails SET sent_at=now(),failed_at=NULL,provider_id=${ids[i]} WHERE publication_id=${publication.id}::uuid AND staff_id=${recipient.staffId}::uuid`));
      } catch {
        await sql`UPDATE schedule_publication_emails SET failed_at=now() WHERE publication_id=${publication.id}::uuid AND batch_number=${batchNumber} AND sent_at IS NULL`;
      }
    }
  } finally { await sql`UPDATE schedule_publications SET sending_until=NULL WHERE id=${publication.id}::uuid`; }
}
