-- Auto Handicap moved from a round-wide setting to a per-group one.
--
-- Daytona and Banker rounds used to read rounds.auto_handicap; each group now
-- carries its own teams.auto_strokes. Rounds created before the change have the
-- round flag set and the team flag still at its FALSE default, so without this
-- their groups would silently lose automatic strokes.
--
-- Run once, before (or with) the deploy that makes the score screens read
-- teams.auto_strokes for these formats. Safe to re-run.

UPDATE teams t
SET auto_strokes = TRUE
FROM rounds r
WHERE t.round_id = r.id
  AND r.format IN ('daytona', 'banker')
  AND r.auto_handicap = TRUE
  AND t.auto_strokes IS DISTINCT FROM TRUE;
