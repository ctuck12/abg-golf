-- Per-player handicap strokes for Best Ball (2v2) matchups:
-- JSON map of player_id -> stroke count, auto-allocated to the hardest holes.
ALTER TABLE best_ball_matchups ADD COLUMN IF NOT EXISTS player_strokes JSONB;
