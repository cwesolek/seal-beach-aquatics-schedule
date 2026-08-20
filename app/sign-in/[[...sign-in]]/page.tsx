import { SignIn } from "@clerk/nextjs";
import Link from "next/link";

export default function SignInPage() {
  return <main className="auth-page"><section className="auth-intro"><p className="eyebrow">Seal Beach Aquatics</p><h1>SBA Schedule</h1><p>Sign in with your staff account to access the schedule.</p></section><section className="auth-panel"><SignIn fallbackRedirectUrl="/" /><p className="password-help">Forgot your password? Select <strong>Forgot password?</strong> in the sign-in form to receive a reset link.</p><Link href="/">Back to SBA Schedule</Link></section></main>;
}
