-- ============================================================
-- Multi-tenant migration
-- Run this in the Supabase SQL editor before deploying the app.
-- ============================================================

-- 1. Organizations
CREATE TABLE IF NOT EXISTS organizations (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  group_password  TEXT NOT NULL,
  admin_password  TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Courses (moves course data out of hardcoded constants)
CREATE TABLE IF NOT EXISTS courses (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  pars        JSONB NOT NULL,   -- array of 18 integers
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pre-populate with the 7 existing courses
INSERT INTO courses (name, slug, pars) VALUES
  ('ACC South Course',       'south',      '[4,4,5,3,4,4,4,3,5,4,3,4,4,5,4,3,4,5]'),
  ('ACC North Course',       'north',      '[4,4,4,3,4,4,5,3,5,3,4,4,5,3,5,4,3,4]'),
  ('Live Oak Golf Club',     'liveoak',    '[4,3,4,4,3,4,4,5,4,4,5,3,4,4,5,4,3,4]'),
  ('Maxwell Golf Course',    'maxwell',    '[4,5,4,4,4,4,3,4,3,5,4,4,4,3,4,5,3,4]'),
  ('Shady Oaks Golf Course', 'shadyoaks',  '[4,3,4,5,4,4,3,3,4,5,4,4,3,4,4,3,5,4]'),
  ('The Hideout Golf Club',  'hideout',    '[5,3,4,4,3,4,5,4,5,4,4,4,3,4,3,5,4,4]'),
  ('Canyon West Golf Course','canyonwest', '[4,4,4,5,4,3,4,3,5,4,4,3,4,5,4,4,3,5]')
ON CONFLICT (slug) DO NOTHING;

-- 3. Add org_id to rounds
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_rounds_org_id ON rounds(org_id);

-- 4. Create a default "ABG" organization and assign all existing rounds to it.
--    This preserves all existing data under one org.
DO $$
DECLARE
  default_org_id UUID;
BEGIN
  INSERT INTO organizations (name, slug, group_password, admin_password)
  VALUES ('Anything But Golf Group', 'abg', 'golf2024', 'admin2024')
  ON CONFLICT (slug) DO NOTHING;

  SELECT id INTO default_org_id FROM organizations WHERE slug = 'abg';

  IF default_org_id IS NOT NULL THEN
    UPDATE rounds SET org_id = default_org_id WHERE org_id IS NULL;
  END IF;
END $$;

-- NOTE: After running, change the default org passwords in Master Admin → Edit Group.
