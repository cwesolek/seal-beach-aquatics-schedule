CREATE TABLE IF NOT EXISTS schedule_publications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start DATE NOT NULL UNIQUE,
  period_end DATE NOT NULL CHECK (period_end=period_start+13),
  posted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  sending_until TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS schedule_publication_emails (
  publication_id UUID NOT NULL REFERENCES schedule_publications(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  batch_number INTEGER NOT NULL,
  sent_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  provider_id TEXT,
  PRIMARY KEY (publication_id,staff_id)
);
