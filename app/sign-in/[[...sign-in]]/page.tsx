import { SignIn } from "@clerk/nextjs";
import { scheduleSignInTarget } from "@/lib/schedule-period";
import Link from "next/link";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ redirect_url?: string }> }) {
  const params = await searchParams;
  const target = scheduleSignInTarget(params.redirect_url);
  return <main className="auth-page"><section className="auth-intro"><p className="eyebrow">Seal Beach Aquatics</p><h1>SBA Schedule</h1><p>Sign in with your staff account to access the schedule.</p></section><section className="auth-panel"><SignIn fallbackRedirectUrl={target} forceRedirectUrl={target === "/" ? undefined : target} /><p className="password-help">Forgot your password? Select <strong>Forgot password?</strong> in the sign-in form to receive a reset link.</p><Link href="/">Back to SBA Schedule</Link></section></main>;
}
