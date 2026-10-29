import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { validPeriodStart, schedulePath } from "@/lib/schedule-period";
import Scheduler from "@/components/scheduler";

function SignInLanding({ target = "/" }: { target?: string }) {
  return <main className="sign-in-landing"><section className="sign-in-card"><p className="eyebrow">Seal Beach Aquatics</p><h1>SBA Schedule</h1><p>Sign in to view your schedule, availability, and staff updates.</p><Link href={target === "/" ? "/sign-in" : `/sign-in?redirect_url=${encodeURIComponent(target)}`}>Sign in to SBA Schedule</Link></section></main>;
}

export default async function Home({ searchParams }: { searchParams: Promise<{ periodStart?: string }> }) {
  const params = await searchParams;
  const periodStart = validPeriodStart(params.periodStart) ? params.periodStart : null;
  const target = periodStart ? schedulePath(periodStart) : "/";
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return <SignInLanding target={target} />;
  const { userId } = await auth();
  if (!userId) return <SignInLanding target={target} />;
  return <Scheduler initialPeriodStart={periodStart} />;
}
