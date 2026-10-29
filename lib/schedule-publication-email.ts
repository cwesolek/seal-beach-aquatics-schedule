import { schedulePath } from "./schedule-period";
export type Publication = { id: string; periodStart: string; periodEnd: string };
export type PublicationRecipient = { staffId: string; email: string };
export async function sendPublicationBatch(publication: Publication, batchNumber: number, recipients: PublicationRecipient[], options: { apiKey?: string; domain?: string; fetcher?: typeof fetch } = {}) {
  const apiKey=options.apiKey ?? process.env.RESEND_API_KEY;
  const domain=options.domain ?? process.env.RESEND_EMAIL_DOMAIN;
  if (!apiKey || !domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) throw new Error("Schedule email is not configured.");
  if (!recipients.length || recipients.length>100) throw new Error("Invalid email batch.");
  const link=`https://sba-schedule.com${schedulePath(publication.periodStart)}`;
  const payload=recipients.map(recipient=>({from:`SBA Schedule <schedule@${domain}>`,to:[recipient.email],subject:`Schedule posted: ${publication.periodStart} through ${publication.periodEnd}`,text:`The Seal Beach Aquatics schedule for ${publication.periodStart} through ${publication.periodEnd} is posted.\n\nView this pay period’s schedule:\n${link}\n\nSign in with your staff account if prompted. You can view your assigned shifts and the team schedule in the app.`}));
  const response=await (options.fetcher ?? fetch)("https://api.resend.com/emails/batch",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json","Idempotency-Key":`schedule-post/${publication.id}/${batchNumber}`},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
  const result=await response.json() as {data?: {id:string}[]};
  if (!response.ok || result.data?.length!==recipients.length || result.data.some(item=>!item.id)) throw new Error(`Schedule email provider rejected batch (${response.status}).`);
  return result.data.map(item=>item.id);
}
