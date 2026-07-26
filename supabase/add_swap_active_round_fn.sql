-- Atomic active-round swap. Round creation now inserts the new round as
-- INACTIVE and calls this function last, so the current round can never be
-- deactivated unless the replacement round was fully created. Both UPDATEs
-- run in one transaction — either the swap happens completely or not at all.
CREATE OR REPLACE FUNCTION swap_active_round(p_round_id UUID, p_org_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE rounds SET is_active = false
  WHERE org_id = p_org_id AND is_active = true AND id <> p_round_id;

  UPDATE rounds SET is_active = true
  WHERE id = p_round_id AND org_id = p_org_id;
END;
$$;
