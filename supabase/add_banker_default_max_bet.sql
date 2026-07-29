-- Admin-configurable default max bet for Banker holes. The scorekeeper can
-- still change the max bet on any individual hole; this is just the starting
-- value. NULL keeps the previous behavior (the minimum bet is used).
--   rounds            → Banker scoring format
--   teams             → Banker side game on a team
--   playing_groups    → Banker side game on a playing group
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS banker_default_max_bet NUMERIC;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS banker_side_game_max_bet NUMERIC;
ALTER TABLE playing_groups ADD COLUMN IF NOT EXISTS banker_side_game_max_bet NUMERIC;
