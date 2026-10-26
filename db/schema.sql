CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT UNIQUE,
  name TEXT NOT NULL,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  role TEXT NOT NULL CHECK (role IN ('manager', 'staff')) DEFAULT 'staff',
  active BOOLEAN NOT NULL DEFAULT true,
  approval_status TEXT NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE staff ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS last_name TEXT;
UPDATE staff SET first_name = CASE WHEN trim(name) ~ '[[:space:]]' THEN regexp_replace(trim(name), '[[:space:]]+[^[:space:]]+$', '') ELSE trim(name) END WHERE first_name IS NULL OR trim(first_name)='';
UPDATE staff SET last_name = CASE WHEN trim(name) ~ '[[:space:]]' THEN regexp_replace(trim(name), '^.*[[:space:]]+', '') ELSE '' END WHERE last_name IS NULL OR trim(last_name)='';
ALTER TABLE staff ALTER COLUMN first_name SET DEFAULT '';
ALTER TABLE staff ALTER COLUMN last_name SET DEFAULT '';
ALTER TABLE staff ALTER COLUMN first_name SET NOT NULL;
ALTER TABLE staff ALTER COLUMN last_name SET NOT NULL;

CREATE TABLE IF NOT EXISTS recurring_shift_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  starts_at TIME NOT NULL,
  ends_at TIME NOT NULL,
  required_staff SMALLINT NOT NULL DEFAULT 2 CHECK (required_staff > 0),
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES recurring_shift_templates(id) ON DELETE SET NULL,
  shift_date DATE NOT NULL,
  title TEXT NOT NULL,
  starts_at TIME NOT NULL,
  ends_at TIME NOT NULL,
  required_staff SMALLINT NOT NULL DEFAULT 2 CHECK (required_staff > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('draft', 'open', 'assigned', 'cancelled')),
  created_by UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shift_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES staff(id),
  assigned_by UUID REFERENCES staff(id),
  scheduled_starts_at TIME,
  scheduled_ends_at TIME,
  actual_starts_at TIME,
  actual_ends_at TIME,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shift_id, staff_id)
);

CREATE TABLE IF NOT EXISTS recurring_staff_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES recurring_shift_templates(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  starts_on DATE NOT NULL,
  scheduled_starts_at TIME,
  scheduled_ends_at TIME,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (template_id, staff_id)
);

CREATE TABLE IF NOT EXISTS recurring_assignment_exclusions (
  template_id UUID NOT NULL REFERENCES recurring_shift_templates(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  created_by UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (template_id, staff_id, shift_date)
);

CREATE TABLE IF NOT EXISTS aquatics_class_week_exclusions (
  week_start DATE PRIMARY KEY,
  created_by UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS worked_shift_adjustment_requests (
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
);

CREATE UNIQUE INDEX IF NOT EXISTS one_pending_hour_adjustment_per_assignment ON worked_shift_adjustment_requests (shift_id, staff_id) WHERE status='pending';

CREATE TABLE IF NOT EXISTS availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'unavailable' CHECK (status IN ('available', 'unavailable', 'preferred')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);

CREATE TABLE IF NOT EXISTS open_shift_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shift_id, staff_id)
);

CREATE TABLE IF NOT EXISTS swap_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  recipient_shift_id UUID REFERENCES shifts(id) ON DELETE CASCADE,
  additional_shift_id UUID REFERENCES shifts(id) ON DELETE CASCADE,
  requester_id UUID NOT NULL REFERENCES staff(id),
  recipient_id UUID REFERENCES staff(id),
  recipient_accepted_at TIMESTAMPTZ,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'cancelled')),
  reviewed_by UUID REFERENCES staff(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pay_period_settings (
  period_start DATE PRIMARY KEY,
  timesheet_due_date DATE NOT NULL,
  updated_by UUID REFERENCES staff(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS timesheet_entries (
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  row_type TEXT NOT NULL CHECK (row_type IN ('regular', 'sick', 'overtime', 'other')),
  entry_key TEXT NOT NULL,
  hours NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (hours >= 0 AND hours <= 999.75),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, period_start, row_type, entry_key)
);

CREATE INDEX IF NOT EXISTS timesheet_entries_staff_period_index ON timesheet_entries (staff_id, period_start);

CREATE INDEX IF NOT EXISTS shifts_date_index ON shifts (shift_date);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_standard_shift_per_date ON shifts (template_id, shift_date) WHERE template_id IS NOT NULL AND status!='cancelled';
CREATE INDEX IF NOT EXISTS availability_staff_dates_index ON availability (staff_id, starts_on, ends_on);
CREATE INDEX IF NOT EXISTS recurring_staff_assignments_active_index ON recurring_staff_assignments (active, template_id, starts_on);
ALTER TABLE recurring_shift_templates ALTER COLUMN required_staff SET DEFAULT 2;
ALTER TABLE shifts ALTER COLUMN required_staff SET DEFAULT 2;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_approval_status_check;
ALTER TABLE staff ADD CONSTRAINT staff_approval_status_check CHECK (approval_status IN ('pending', 'approved', 'rejected'));
ALTER TABLE staff ALTER COLUMN approval_status SET DEFAULT 'pending';
CREATE INDEX IF NOT EXISTS staff_approval_status_index ON staff (approval_status, created_at);
ALTER TABLE swap_requests ADD COLUMN IF NOT EXISTS recipient_accepted_at TIMESTAMPTZ;
ALTER TABLE swap_requests ADD COLUMN IF NOT EXISTS recipient_shift_id UUID REFERENCES shifts(id) ON DELETE CASCADE;
ALTER TABLE swap_requests ADD COLUMN IF NOT EXISTS additional_shift_id UUID REFERENCES shifts(id) ON DELETE CASCADE;
ALTER TABLE shift_assignments ADD COLUMN IF NOT EXISTS scheduled_starts_at TIME;
ALTER TABLE shift_assignments ADD COLUMN IF NOT EXISTS scheduled_ends_at TIME;
ALTER TABLE recurring_staff_assignments ADD COLUMN IF NOT EXISTS scheduled_starts_at TIME;
ALTER TABLE recurring_staff_assignments ADD COLUMN IF NOT EXISTS scheduled_ends_at TIME;

ALTER TABLE swap_requests ADD COLUMN IF NOT EXISTS manager_dismissed_at TIMESTAMPTZ;
