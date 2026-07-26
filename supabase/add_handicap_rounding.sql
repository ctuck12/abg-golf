-- Handicap stroke rounding for the round: 'down' (legacy floor/trunc) or
-- 'nearest' (round half-up: 7.4 -> 7, 7.5 -> 8).
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS handicap_rounding TEXT NOT NULL DEFAULT 'down';
