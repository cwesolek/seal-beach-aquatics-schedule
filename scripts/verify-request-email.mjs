const domain = process.env.RESEND_EMAIL_DOMAIN;
if (!process.env.RESEND_API_KEY || !domain) {
  console.log('REQUEST_EMAIL_CHECK: configuration incomplete');
} else {
  console.log(`REQUEST_EMAIL_CHECK: sender domain ${domain}`);
  const response = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }, signal: AbortSignal.timeout(10000) });
  const result = await response.json();
  if (response.ok) {
    const match = result.data?.find((item) => item.name === domain);
    console.log(`REQUEST_EMAIL_CHECK: domain status ${match?.status ?? 'not found'}`);
  } else console.log(`REQUEST_EMAIL_CHECK: domain lookup HTTP ${response.status}`);
}
// Resend's synthetic test inbox exercises the provider without emailing staff.
if (process.env.VERCEL_ENV === 'preview' && process.env.RESEND_API_KEY && domain) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': 'sba-request-email-connection-check-v1' },
    body: JSON.stringify({ from: `SBA Schedule <schedule@${domain}>`, to: ['delivered@resend.dev'], subject: 'SBA request email connection check', text: 'Synthetic delivery check. No employee data.' }),
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json();
  if (!response.ok || !result.id) throw new Error(`Request email provider check failed: HTTP ${response.status}`);
  console.log('REQUEST_EMAIL_CHECK: provider accepted synthetic email');
}
