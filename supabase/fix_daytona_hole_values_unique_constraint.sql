-- daytona_hole_values unique constraint fix for mixed groups.
-- The table likely has a unique constraint on (round_id, hole_number) WITHOUT team_id.
-- This prevents different groups from having their own press values for the same holes.
-- Fix: drop the old constraint and add one that includes team_id.

DO $$
DECLARE
  cname TEXT;
BEGIN
  -- Drop any unique constraint on (round_id, hole_number) that does NOT include team_id
  FOR cname IN
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    WHERE tc.table_name = 'daytona_hole_values'
      AND tc.constraint_type IN ('UNIQUE', 'PRIMARY KEY')
      AND tc.constraint_name NOT IN (
        SELECT kcu2.constraint_name
        FROM information_schema.key_column_usage kcu2
        WHERE kcu2.table_name = 'daytona_hole_values'
          AND kcu2.column_name = 'team_id'
      )
      AND tc.constraint_name IN (
        SELECT kcu3.constraint_name
        FROM information_schema.key_column_usage kcu3
        WHERE kcu3.table_name = 'daytona_hole_values'
          AND kcu3.column_name = 'hole_number'
      )
  LOOP
    RAISE NOTICE 'Dropping constraint: %', cname;
    EXECUTE 'ALTER TABLE daytona_hole_values DROP CONSTRAINT ' || quote_ident(cname);
  END LOOP;
END $$;

-- Add (or ensure) correct unique constraint including team_id
CREATE UNIQUE INDEX IF NOT EXISTS daytona_hole_values_round_team_hole_unique
  ON daytona_hole_values (round_id, team_id, hole_number);
