-- Add hole_range to matchups and best_ball_matchups for front9/back9 split matchups
ALTER TABLE matchups ADD COLUMN IF NOT EXISTS hole_range TEXT NOT NULL DEFAULT 'all';
ALTER TABLE best_ball_matchups ADD COLUMN IF NOT EXISTS hole_range TEXT NOT NULL DEFAULT 'all';

-- Add daytona_variant_back9 to teams for split-nine Daytona scoring
ALTER TABLE teams ADD COLUMN IF NOT EXISTS daytona_variant_back9 TEXT;
