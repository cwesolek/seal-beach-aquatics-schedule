import { NextResponse } from "next/server";
import { requireManager } from "@/lib/auth";
import { database } from "@/lib/db";
import { periodEnd, validPeriodStart } from "@/lib/schedule-period";
import { postScheduleQueries, publicationDeliveryCounts } from "@/lib/schedule-publications";
import { deliverSchedulePublication } from "@/lib/deliver-schedule-publication";
import type { Publication } from "@/lib/schedule-publication-email";
export const maxDuration=60;
export async function POST(request: Request) {
  let viewer;
  try { viewer=await requireManager(); } catch { return NextResponse.json({error:"Manager access is required."},{status:403}); }
  try {
    const {periodStart}=await request.json();
    if (!validPeriodStart(periodStart)) return NextResponse.json({error:"Choose a valid pay-period start date."},{status:400});
    const sql=database();
    const results=await sql.transaction(postScheduleQueries(sql,periodStart,periodEnd(periodStart),viewer.id));
    const publication=results[2][0] as Publication | undefined;
    if (!publication) return NextResponse.json({error:"Add at least one shift before posting this pay period."},{status:400});
    await deliverSchedulePublication(sql,publication);
    const {sent,total}=await publicationDeliveryCounts(sql,publication.id);
    return NextResponse.json({ok:true,message:`Schedule posted for ${publication.periodStart} through ${publication.periodEnd}. ${sent} of ${total} staff emails sent.${sent<total ? " The posted notice is visible in the app. Use Retry unsent emails to finish notifying staff." : ""}`});
  } catch { return NextResponse.json({error:"Could not finish posting or emailing the schedule. Refresh to check its posted status, then retry unsent emails."},{status:500}); }
}
