CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT UNIQUE,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  role TEXT NOT NULL CHECK (role IN ('manager', 'staff')) DEFAULT 'staff',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recurring_shift_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  starts_at TIME NOT NULL,
  ends_at TIME NOT NULL,
  required_staff SMALLINT NOT NULL DEFAULT 1 CHECK (required_staff > 0),
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES recurring_shift_templates(id) ON DELETE SET NULL,
  shift_date DATE NOT NULL,
  title TEXT NOT NULL,
  starts_at TIME NOT NULL,
  ends_at TIME NOT NULL,
  required_staff SMALLINT NOT NULL DEFAULT 1 CHECK (required_staff > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('draft', 'open', 'assigned', 'cancelled')),
  created_by UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shift_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES staff(id),
  assigned_by UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shift_id, staff_id)
);

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
  requester_id UUID NOT NULL REFERENCES staff(id),
  recipient_id UUID REFERENCES staff(id),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'cancelled')),
  reviewed_by UUID REFERENCES staff(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shifts_date_index ON shifts (shift_date);
CREATE INDEX IF NOT EXISTS availability_staff_dates_index ON availability (staff_id, starts_on, ends_on);
