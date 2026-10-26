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
