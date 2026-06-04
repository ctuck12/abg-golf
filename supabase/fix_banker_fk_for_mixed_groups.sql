-- banker_holes and banker_bets were originally built for the 'teams' format.
-- Their team_id column has a FK to teams(id), which rejects playing_group IDs
-- when banker is used as a side game in Mixed Group rounds.
-- This migration drops those FK constraints so both team and playing_group IDs work.

DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT tc.constraint_name INTO cname
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
  WHERE tc.table_name = 'banker_holes'
    AND kcu.column_name = 'team_id'
    AND tc.constraint_type = 'FOREIGN KEY';

  IF cname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE banker_holes DROP CONSTRAINT ' || quote_ident(cname);
    RAISE NOTICE 'Dropped FK constraint % from banker_holes.team_id', cname;
  ELSE
    RAISE NOTICE 'No FK constraint found on banker_holes.team_id — nothing to drop';
  END IF;
END $$;

DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT tc.constraint_name INTO cname
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
  WHERE tc.table_name = 'banker_bets'
    AND kcu.column_name = 'team_id'
    AND tc.constraint_type = 'FOREIGN KEY';

  IF cname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE banker_bets DROP CONSTRAINT ' || quote_ident(cname);
    RAISE NOTICE 'Dropped FK constraint % from banker_bets.team_id', cname;
  ELSE
    RAISE NOTICE 'No FK constraint found on banker_bets.team_id — nothing to drop';
  END IF;
END $$;
