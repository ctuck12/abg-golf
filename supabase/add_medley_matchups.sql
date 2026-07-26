-- Medley matchups: 3-5 individual players, lowest score wins.
-- players: JSONB array of { id, front, back, total } — per-player handicap
-- strokes subtracted from segment totals (not allocated to holes).
CREATE TABLE IF NOT EXISTS medley_matchups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  players JSONB NOT NULL,
  bet_type TEXT NOT NULL DEFAULT 'straight',
  amount NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
