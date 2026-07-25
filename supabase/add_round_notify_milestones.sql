-- Milestone notification stamps: set once when the front nine / full round
-- completes so each notification sends exactly once. Cleared with scores.
ALTER TABLE rounds
  ADD COLUMN IF NOT EXISTS front9_notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finished_notified_at TIMESTAMPTZ;
