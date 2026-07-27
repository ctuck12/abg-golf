-- Per-team / per-playing-group stroke rounding override (null = round default)
ALTER TABLE teams ADD COLUMN IF NOT EXISTS stroke_rounding TEXT;
ALTER TABLE playing_groups ADD COLUMN IF NOT EXISTS stroke_rounding TEXT;
