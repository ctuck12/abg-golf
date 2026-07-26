-- Press support for Medley matchups
ALTER TABLE medley_matchups ADD COLUMN IF NOT EXISTS press JSONB NOT NULL DEFAULT '[]'::jsonb;
