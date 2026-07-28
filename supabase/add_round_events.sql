-- Mid-round audit trail: who changed what during a round (HCP edits,
-- skins/settings changes, matchup edits, clears). Shown in the Admin Hub's
-- "Round History" section. Until this table exists, logging calls fail
-- silently and the app behaves exactly as before.
CREATE TABLE IF NOT EXISTS round_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  actor TEXT NOT NULL DEFAULT 'Unknown',
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS round_events_round_created_idx
  ON round_events (round_id, created_at DESC);
