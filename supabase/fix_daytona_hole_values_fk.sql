-- daytona_hole_values.team_id originally had a FK to teams(id).
-- When Daytona is used as a side game in Mixed Group rounds, the playing_group
-- ID is stored as team_id, which violates the FK and silently drops the save.
-- This migration drops that FK constraint so both team and playing_group IDs work.

DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT tc.constraint_name INTO cname
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
  WHERE tc.table_name = 'daytona_hole_values'
    AND kcu.column_name = 'team_id'
    AND tc.constraint_type = 'FOREIGN KEY';

  IF cname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE daytona_hole_values DROP CONSTRAINT ' || quote_ident(cname);
    RAISE NOTICE 'Dropped FK constraint % from daytona_hole_values.team_id', cname;
  ELSE
    RAISE NOTICE 'No FK constraint found on daytona_hole_values.team_id — nothing to drop';
  END IF;
END $$;
