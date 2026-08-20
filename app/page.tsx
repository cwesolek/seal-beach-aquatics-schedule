import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import Scheduler from "@/components/scheduler";

function SignInLanding() {
  return <main className="sign-in-landing"><section className="sign-in-card"><p className="eyebrow">Seal Beach Aquatics</p><h1>SBA Schedule</h1><p>Sign in to view your schedule, availability, and staff updates.</p><Link href="/sign-in">Sign in to SBA Schedule</Link></section></main>;
}

export default async function Home() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return <SignInLanding />;
  const { userId } = await auth();
  if (!userId) return <SignInLanding />;
  return <Scheduler />;
}
