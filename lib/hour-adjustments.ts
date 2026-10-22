import { database } from "@/lib/db";

export async function ensureHourAdjustmentSchema(sql: ReturnType<typeof database>) {
  await sql`ALTER TABLE shift_assignments ADD COLUMN IF NOT EXISTS actual_starts_at TIME`;
  await sql`ALTER TABLE shift_assignments ADD COLUMN IF NOT EXISTS actual_ends_at TIME`;
  await sql`CREATE TABLE IF NOT EXISTS worked_shift_adjustment_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    requested_starts_at TIME NOT NULL,
    requested_ends_at TIME NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
    reviewed_by UUID REFERENCES staff(id),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS one_pending_hour_adjustment_per_assignment ON worked_shift_adjustment_requests (shift_id, staff_id) WHERE status='pending'`;
}
