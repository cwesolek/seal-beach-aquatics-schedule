export type RequestEmail = { id: string; to: string; requester: string; recipient: string; shift: string; recipientShift?: string | null; additionalShift?: string | null };
export async function sendRequestEmail(request: RequestEmail, options: { apiKey?: string; domain?: string; fetcher?: typeof fetch } = {}) {
  const apiKey = options.apiKey ?? process.env.RESEND_API_KEY;
  const domain = options.domain ?? process.env.RESEND_EMAIL_DOMAIN;
  if (!apiKey || !domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) throw new Error("Request email is not configured.");
  const kind = request.recipientShift ? "swap" : "cover";
  const text = [
    `Hi ${request.recipient},`,
    `${request.requester} has requested a ${kind} with you.`,
    `Their shift: ${request.shift}`,
    request.additionalShift ? `Also covered: ${request.additionalShift}` : "",
    request.recipientShift ? `Your shift to exchange: ${request.recipientShift}` : "",
    "Sign in at https://sba-schedule.com/ and select Review and accept (or Swaps) to review this request.",
    "If you accept, the schedule and regular timesheet hours update automatically. Opening this email does not accept the request.",
  ].filter(Boolean).join("\n\n");
  const response = await (options.fetcher ?? fetch)("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `shift-request/${request.id}` },
    body: JSON.stringify({ from: `SBA Schedule <schedule@${domain}>`, to: [request.to], subject: `${request.requester} requested a shift ${kind}`, text }),
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json() as { id?: string };
  if (!response.ok || !result.id) throw new Error(`Email provider did not accept the request (${response.status}).`);
  return result.id;
}
