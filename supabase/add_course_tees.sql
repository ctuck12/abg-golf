-- Tee sets per course, and which one a round is played from.
--
-- Groundwork for posting scores to GHIN. Nothing that scores a round uses any
-- of this: every game in the app works off raw index differences, which is why
-- no rating was ever stored. A Score Differential does need them -- the rating
-- and slope of the exact tee played -- and GHIN won't accept a score without
-- knowing the course and tee either.
--
-- Pars and stroke indexes stay on the course: they're the same whichever tee you
-- play. Only the rating, slope and yardage change, so those live here.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS course_tees (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id       UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  course_rating   NUMERIC(4,1),
  slope_rating    INTEGER,
  -- Identify the same tee inside GHIN. Nullable: a tee is usable for round
  -- setup without them, it just can't be posted.
  ghin_course_id  TEXT,
  ghin_tee_set_id TEXT,
  position        INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS course_tees_course_id_idx ON course_tees (course_id, position);

-- Ratings that can't be real would produce silently wrong differentials, so the
-- database refuses them rather than trusting the form.
ALTER TABLE course_tees DROP CONSTRAINT IF EXISTS course_tees_course_rating_range;
ALTER TABLE course_tees ADD CONSTRAINT course_tees_course_rating_range
  CHECK (course_rating IS NULL OR (course_rating >= 55 AND course_rating <= 85));

ALTER TABLE course_tees DROP CONSTRAINT IF EXISTS course_tees_slope_rating_range;
ALTER TABLE course_tees ADD CONSTRAINT course_tees_slope_rating_range
  CHECK (slope_rating IS NULL OR (slope_rating >= 55 AND slope_rating <= 155));

-- Which tee this round was played from. Nullable so a round can still be
-- created for a course with no tees on file.
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS course_tee_id UUID REFERENCES course_tees(id) ON DELETE SET NULL;

-- An earlier pass put the tee on the course row itself, before a round needed to
-- pick one. Drop those if that version was ever applied.
ALTER TABLE courses DROP COLUMN IF EXISTS tee_name;
ALTER TABLE courses DROP COLUMN IF EXISTS course_rating;
ALTER TABLE courses DROP COLUMN IF EXISTS slope_rating;
ALTER TABLE courses DROP COLUMN IF EXISTS ghin_course_id;
ALTER TABLE courses DROP COLUMN IF EXISTS ghin_tee_set_id;
