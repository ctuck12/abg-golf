-- Stamped when the first score of a round is saved; used to trigger the
-- one-time "first scores are in" email. Cleared when scores are cleared.
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS first_score_at TIMESTAMPTZ;
