-- Add holes_range to players: 'all' (default), 'front9', or 'back9'.
-- Players outside their range are skipped by score entry and completeness checks.
ALTER TABLE players ADD COLUMN IF NOT EXISTS holes_range TEXT NOT NULL DEFAULT 'all';
