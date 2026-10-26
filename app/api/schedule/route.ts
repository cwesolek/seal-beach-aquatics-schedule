import { NextResponse } from "next/server";
import { database, hasDatabase } from "@/lib/db";
import { ApprovalRequiredError, requireViewer } from "@/lib/auth";
import { demoSnapshot } from "@/lib/demo-data";
import { defaultTimesheetDueDate, isoDate, payPeriodEnd, payPeriodStart } from "@/lib/date";
import { ensureHourAdjustmentSchema } from "@/lib/hour-adjustments";
import { applyRecurringAssignments } from "@/lib/recurring-assignments";

export async function GET(request: Request) {
  const requestedOffset = Number(new URL(request.url).searchParams.get("periodOffset") ?? 0);
  const periodOffset = Number.isInteger(requestedOffset) ? Math.max(-26, Math.min(26, requestedOffset)) : 0;
  if (!hasDatabase()) return NextResponse.json(demoSnapshot(periodOffset));
  try {
    const viewer = await requireViewer();
    const periodReference = payPeriodStart();
    periodReference.setDate(periodReference.getDate() + periodOffset * 14);
    const start = isoDate(payPeriodStart(periodReference));
    const end = isoDate(payPeriodEnd(periodReference));
    const endExclusive = new Date(`${end}T12:00:00`); endExclusive.setDate(endExclusive.getDate() + 1);
    const sql = database();
    await ensureHourAdjustmentSchema(sql);
    await applyRecurringAssignments(sql, start, end);
    const hourAdjustmentsQuery = viewer.role === "manager"
      ? sql`SELECT request.id, request.shift_id AS "shiftId", request.staff_id AS "staffId", staff.name AS staff, shift.title AS "shiftTitle", to_char(shift.shift_date, 'YYYY-MM-DD') AS "shiftDate", to_char(COALESCE(assignment.scheduled_starts_at, shift.starts_at), 'HH24:MI') AS "scheduledStartsAt", to_char(COALESCE(assignment.scheduled_ends_at, shift.ends_at), 'HH24:MI') AS "scheduledEndsAt", to_char(request.requested_starts_at, 'HH24:MI') AS "requestedStartsAt", to_char(request.requested_ends_at, 'HH24:MI') AS "requestedEndsAt", request.note, request.status FROM worked_shift_adjustment_requests request JOIN shifts shift ON shift.id=request.shift_id JOIN staff ON staff.id=request.staff_id JOIN shift_assignments assignment ON assignment.shift_id=request.shift_id AND assignment.staff_id=request.staff_id WHERE request.status='pending' ORDER BY shift.shift_date, shift.starts_at`
      : sql`SELECT request.id, request.shift_id AS "shiftId", request.staff_id AS "staffId", staff.name AS staff, shift.title AS "shiftTitle", to_char(shift.shift_date, 'YYYY-MM-DD') AS "shiftDate", to_char(COALESCE(assignment.scheduled_starts_at, shift.starts_at), 'HH24:MI') AS "scheduledStartsAt", to_char(COALESCE(assignment.scheduled_ends_at, shift.ends_at), 'HH24:MI') AS "scheduledEndsAt", to_char(request.requested_starts_at, 'HH24:MI') AS "requestedStartsAt", to_char(request.requested_ends_at, 'HH24:MI') AS "requestedEndsAt", request.note, request.status FROM worked_shift_adjustment_requests request JOIN shifts shift ON shift.id=request.shift_id JOIN staff ON staff.id=request.staff_id JOIN shift_assignments assignment ON assignment.shift_id=request.shift_id AND assignment.staff_id=request.staff_id WHERE request.staff_id=${viewer.id}::uuid ORDER BY request.created_at DESC LIMIT 20`;
    const swapsQuery = viewer.role === "manager"
      ? sql`SELECT sr.id, sr.shift_id AS "shiftId", sr.recipient_shift_id AS "recipientShiftId", sr.additional_shift_id AS "additionalShiftId", sr.requester_id AS "requesterId", sr.recipient_id AS "recipientId", sr.recipient_accepted_at IS NOT NULL AS "recipientAccepted", requester.name AS requester, s.title || ' · ' || to_char(s.shift_date, 'Mon DD') || ' · ' || to_char(s.starts_at, 'HH24:MI') AS shift, recipient.name AS recipient, rs.title || ' · ' || to_char(rs.shift_date, 'Mon DD') || ' · ' || to_char(rs.starts_at, 'HH24:MI') AS "recipientShift", extra.title || ' · ' || to_char(extra.shift_date, 'Mon DD') || ' · ' || to_char(extra.starts_at, 'HH24:MI') AS "additionalShift", sr.manager_dismissed_at IS NOT NULL AS "managerDismissed", sr.reviewed_at AS "acceptedAt", sr.status FROM swap_requests sr JOIN staff requester ON requester.id=sr.requester_id JOIN shifts s ON s.id=sr.shift_id JOIN staff recipient ON recipient.id=sr.recipient_id LEFT JOIN shifts rs ON rs.id=sr.recipient_shift_id LEFT JOIN shifts extra ON extra.id=sr.additional_shift_id WHERE sr.status IN ('pending','approved') AND (sr.manager_dismissed_at IS NULL OR (sr.status='pending' AND sr.recipient_id=${viewer.id}::uuid)) ORDER BY sr.created_at DESC`
      : sql`SELECT sr.id, sr.shift_id AS "shiftId", sr.recipient_shift_id AS "recipientShiftId", sr.additional_shift_id AS "additionalShiftId", sr.requester_id AS "requesterId", sr.recipient_id AS "recipientId", sr.recipient_accepted_at IS NOT NULL AS "recipientAccepted", requester.name AS requester, s.title || ' · ' || to_char(s.shift_date, 'Mon DD') || ' · ' || to_char(s.starts_at, 'HH24:MI') AS shift, recipient.name AS recipient, rs.title || ' · ' || to_char(rs.shift_date, 'Mon DD') || ' · ' || to_char(rs.starts_at, 'HH24:MI') AS "recipientShift", extra.title || ' · ' || to_char(extra.shift_date, 'Mon DD') || ' · ' || to_char(extra.starts_at, 'HH24:MI') AS "additionalShift", sr.manager_dismissed_at IS NOT NULL AS "managerDismissed", sr.reviewed_at AS "acceptedAt", sr.status FROM swap_requests sr JOIN staff requester ON requester.id=sr.requester_id JOIN shifts s ON s.id=sr.shift_id JOIN staff recipient ON recipient.id=sr.recipient_id LEFT JOIN shifts rs ON rs.id=sr.recipient_shift_id LEFT JOIN shifts extra ON extra.id=sr.additional_shift_id WHERE sr.status='pending' AND (sr.requester_id=${viewer.id}::uuid OR sr.recipient_id=${viewer.id}::uuid) ORDER BY sr.created_at DESC`;
    const availabilityQuery = viewer.role === "manager"
      ? sql`SELECT availability.id, staff.name AS staff, COALESCE(availability.note, availability.status) AS note, availability.status, to_char(availability.starts_on, 'YYYY-MM-DD') AS "startsOn", to_char(availability.ends_on, 'YYYY-MM-DD') AS "endsOn" FROM availability JOIN staff ON staff.id=availability.staff_id ORDER BY availability.created_at DESC LIMIT 50`
      : sql`SELECT availability.id, staff.name AS staff, COALESCE(availability.note, availability.status) AS note, availability.status, to_char(availability.starts_on, 'YYYY-MM-DD') AS "startsOn", to_char(availability.ends_on, 'YYYY-MM-DD') AS "endsOn" FROM availability JOIN staff ON staff.id=availability.staff_id WHERE availability.staff_id=${viewer.id}::uuid ORDER BY availability.created_at DESC LIMIT 50`;
    const timesheetEntriesQuery = viewer.role === "manager"
      ? sql`SELECT staff_id::text AS "staffId", row_type AS "rowType", entry_key AS "entryKey", hours::float AS hours FROM timesheet_entries WHERE period_start=${start}::date ORDER BY staff_id, row_type, entry_key`
      : sql`SELECT staff_id::text AS "staffId", row_type AS "rowType", entry_key AS "entryKey", hours::float AS hours FROM timesheet_entries WHERE staff_id=${viewer.id}::uuid AND period_start=${start}::date ORDER BY row_type, entry_key`;
    const [staff, shifts, templates, swaps, availability, settings, hourAdjustments, pendingProfiles, aquaticsExclusions, timesheetEntries] = await Promise.all([
      sql`SELECT id, name, first_name AS "firstName", last_name AS "lastName", email, phone, role, active FROM staff WHERE active = true AND approval_status='approved' ORDER BY lower(last_name), lower(first_name), lower(name)`,
      sql`SELECT s.id, s.template_id AS "templateId", to_char(s.shift_date, 'YYYY-MM-DD') AS date, s.title, to_char(s.starts_at, 'HH24:MI') AS "startsAt", to_char(s.ends_at, 'HH24:MI') AS "endsAt", s.required_staff AS "requiredStaff", COUNT(sa.id)::int AS "assignedCount", s.status, COALESCE(string_agg(a.name, ', ' ORDER BY sa.created_at), 'Open') AS assignee, COALESCE(json_agg(json_build_object('id', a.id::text, 'name', a.name, 'scheduledStartsAt', CASE WHEN sa.scheduled_starts_at IS NULL THEN NULL ELSE to_char(sa.scheduled_starts_at, 'HH24:MI') END, 'scheduledEndsAt', CASE WHEN sa.scheduled_ends_at IS NULL THEN NULL ELSE to_char(sa.scheduled_ends_at, 'HH24:MI') END, 'actualStartsAt', CASE WHEN sa.actual_starts_at IS NULL THEN NULL ELSE to_char(sa.actual_starts_at, 'HH24:MI') END, 'actualEndsAt', CASE WHEN sa.actual_ends_at IS NULL THEN NULL ELSE to_char(sa.actual_ends_at, 'HH24:MI') END, 'isRecurring', EXISTS (SELECT 1 FROM recurring_staff_assignments recurring WHERE recurring.template_id=s.template_id AND recurring.staff_id=a.id AND recurring.active=true AND recurring.starts_on<=s.shift_date)) ORDER BY sa.created_at) FILTER (WHERE a.id IS NOT NULL), '[]'::json) AS "assignedStaff" FROM shifts s LEFT JOIN shift_assignments sa ON sa.shift_id=s.id LEFT JOIN staff a ON a.id=sa.staff_id WHERE s.shift_date >= ${start}::date AND s.shift_date < ${isoDate(endExclusive)}::date GROUP BY s.id ORDER BY s.shift_date, s.starts_at`,
      sql`SELECT id, title, day_of_week AS "dayOfWeek", to_char(starts_at, 'HH24:MI') AS "startsAt", to_char(ends_at, 'HH24:MI') AS "endsAt", required_staff AS "requiredStaff" FROM recurring_shift_templates WHERE active = true ORDER BY day_of_week, starts_at`,
      swapsQuery,
      availabilityQuery,
      sql`SELECT to_char(timesheet_due_date, 'YYYY-MM-DD') AS "dueDate" FROM pay_period_settings WHERE period_start = ${start}::date LIMIT 1`,
      hourAdjustmentsQuery,
      viewer.role === "manager" ? sql`SELECT id, name, email, to_char(created_at, 'YYYY-MM-DD') AS "requestedOn" FROM staff WHERE active=true AND approval_status='pending' ORDER BY created_at` : Promise.resolve([]),
      sql`SELECT to_char(week_start, 'YYYY-MM-DD') AS "weekStart" FROM aquatics_class_week_exclusions WHERE week_start BETWEEN ${start}::date - 6 AND ${end}::date`,
      timesheetEntriesQuery,
    ]);
    return NextResponse.json({ demo: false, viewer, staff, shifts, templates, swaps, availability, hourAdjustments, timesheetEntries, pendingProfiles, aquaticsExcludedWeeks: aquaticsExclusions.map((item) => item.weekStart), periodOffset, payPeriod: { start, end, dueDate: settings[0]?.dueDate ?? isoDate(defaultTimesheetDueDate(periodReference)), defaultDueDate: isoDate(defaultTimesheetDueDate(periodReference)) } });
  } catch (error) {
    if (error instanceof ApprovalRequiredError) return NextResponse.json({ approvalRequired: true, rejected: error.rejected, viewer: { ...error.viewer, role: "staff" } }, { status: 403 });
    return NextResponse.json({ ...demoSnapshot(periodOffset), authRequired: true });
  }
}
