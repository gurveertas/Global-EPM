-- Lets the owner role switch to eszy_app (SET ROLE), so maintenance scripts such as the TAS
-- data move run under row-level security even when started with the owner connection.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eszy_app') AND current_user <> 'eszy_app' THEN
    EXECUTE format('GRANT eszy_app TO %I', current_user);
  END IF;
END $$;
