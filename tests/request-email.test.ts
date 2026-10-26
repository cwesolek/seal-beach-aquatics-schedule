import test from "node:test";
import assert from "node:assert/strict";
import { sendRequestEmail } from "../lib/request-email";
const request = { id: "request-123", to: "chosen@example.com", requester: "Requester", recipient: "Recipient", shift: "Morning · Oct 26, 2026 · 06:00–10:00" };
test("emails only the selected employee with a sign-in link and idempotency key", async () => {
  let calls = 0;
  const fetcher = (async (url, options) => {
    calls++; assert.equal(url, "https://api.resend.com/emails");
    const payload = JSON.parse(options?.body as string);
    assert.deepEqual(payload.to, [request.to]); assert.equal(payload.from, "SBA Schedule <schedule@mail.example.com>");
    assert.match(payload.text, /https:\/\/sba-schedule.com\//); assert.match(payload.text, /Opening this email does not accept/);
    assert.equal((options?.headers as Record<string,string>)["Idempotency-Key"], "shift-request/request-123");
    return new Response(JSON.stringify({ id: "email-123" }), { status: 200 });
  }) as typeof fetch;
  assert.equal(await sendRequestEmail(request, { apiKey: "test", domain: "mail.example.com", fetcher }), "email-123");
  assert.equal(calls, 1);
});
test("swap and full-day emails include every affected shift", async () => {
  const fetcher = (async (_url, options) => {
    const payload = JSON.parse(options?.body as string);
    assert.match(payload.subject, /swap/); assert.match(payload.text, /Your shift to exchange: Evening/); assert.match(payload.text, /Also covered: Midday/);
    return new Response(JSON.stringify({ id: "email-456" }), { status: 200 });
  }) as typeof fetch;
  await sendRequestEmail({ ...request, recipientShift: "Evening", additionalShift: "Midday" }, { apiKey: "test", domain: "mail.example.com", fetcher });
});
test("provider errors are never reported as sent", async () => {
  const fetcher = (async () => new Response(JSON.stringify({ message: "domain unverified" }), { status: 403 })) as typeof fetch;
  await assert.rejects(sendRequestEmail(request, { apiKey: "test", domain: "mail.example.com", fetcher }), /403/);
});
