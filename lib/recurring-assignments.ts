import { database } from "@/lib/db";

export async function applyRecurringAssignments(sql: ReturnType<typeof database>, start: string, end: string) {
  await sql`
    INSERT INTO shifts (template_id, shift_date, title, starts_at, ends_at, required_staff, status, created_by)
    SELECT DISTINCT template.id, day::date, template.title, template.starts_at, template.ends_at, template.required_staff, 'open', recurring.created_by
    FROM generate_series(${start}::date, ${end}::date, interval '1 day') day
    JOIN recurring_shift_templates template ON template.active=true AND template.day_of_week=EXTRACT(DOW FROM day)::int
    JOIN recurring_staff_assignments recurring ON recurring.template_id=template.id AND recurring.active=true AND recurring.starts_on<=day::date
    JOIN staff ON staff.id=recurring.staff_id AND staff.active=true AND staff.approval_status='approved'
    WHERE NOT EXISTS (SELECT 1 FROM shifts existing WHERE existing.template_id=template.id AND existing.shift_date=day::date AND existing.status!='cancelled')
      AND NOT (lower(template.title)='aquatics class' AND EXISTS (SELECT 1 FROM aquatics_class_week_exclusions exclusion WHERE day::date BETWEEN exclusion.week_start AND exclusion.week_start + 6))
    ON CONFLICT DO NOTHING`;

  await sql`
    WITH eligible AS (
      SELECT shift.id AS shift_id, recurring.staff_id, recurring.created_by, recurring.scheduled_starts_at, recurring.scheduled_ends_at,
        shift.required_staff - (SELECT COUNT(*) FROM shift_assignments existing WHERE existing.shift_id=shift.id) AS open_positions,
        ROW_NUMBER() OVER (PARTITION BY shift.id ORDER BY recurring.created_at, recurring.id) AS position
      FROM shifts shift
      JOIN recurring_staff_assignments recurring ON recurring.template_id=shift.template_id AND recurring.active=true AND recurring.starts_on<=shift.shift_date
      JOIN staff ON staff.id=recurring.staff_id AND staff.active=true AND staff.approval_status='approved'
      WHERE shift.shift_date BETWEEN ${start}::date AND ${end}::date AND shift.status!='cancelled'
        AND NOT (lower(shift.title)='aquatics class' AND EXISTS (SELECT 1 FROM aquatics_class_week_exclusions exclusion WHERE shift.shift_date BETWEEN exclusion.week_start AND exclusion.week_start + 6))
        AND NOT EXISTS (SELECT 1 FROM recurring_assignment_exclusions exclusion WHERE exclusion.template_id=shift.template_id AND exclusion.staff_id=recurring.staff_id AND exclusion.shift_date=shift.shift_date)
        AND NOT EXISTS (SELECT 1 FROM shift_assignments assigned WHERE assigned.shift_id=shift.id AND assigned.staff_id=recurring.staff_id)
    )
    INSERT INTO shift_assignments (shift_id, staff_id, assigned_by, scheduled_starts_at, scheduled_ends_at)
    SELECT shift_id, staff_id, created_by, scheduled_starts_at, scheduled_ends_at FROM eligible WHERE position<=open_positions
    ON CONFLICT (shift_id, staff_id) DO NOTHING`;

  await sql`
    UPDATE shifts SET status=CASE WHEN (SELECT COUNT(*) FROM shift_assignments WHERE shift_id=shifts.id)>=required_staff THEN 'assigned' ELSE 'open' END
    WHERE shift_date BETWEEN ${start}::date AND ${end}::date AND status!='cancelled'`;
}
