-- Which holes allow the 2× bet doublers in Banker.
--
--   'par3' — doubling is offered on par 3s only (the default)
--   'all'  — doubling is offered on every hole (the old behavior)
--
-- NULL reads as 'par3' in the app, so existing rows pick up the new default
-- without a backfill. This governs only whether the doublers are OFFERED —
-- the automatic birdie 2× / eagle 3× on the winning score is untouched and
-- still applies on every hole.
--
--   rounds            → Banker scoring format
--   teams             → Banker side game on a team
--   playing_groups    → Banker side game on a playing group
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS banker_double_scope TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS banker_double_scope TEXT;
ALTER TABLE playing_groups ADD COLUMN IF NOT EXISTS banker_double_scope TEXT;
