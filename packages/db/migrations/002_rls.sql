-- Row-level security: every company table only shows rows whose tenant_id matches
-- the app.tenant_id setting, which the API sets at the start of each transaction.
-- The API connects as eszy_app, a role without BYPASSRLS, so a missing setting returns no rows.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'company_settings','roles','teams','users','user_roles','refresh_tokens','user_tokens','holidays',
    'leave_types','leave_balances','leave_requests','wfh_requests','clients','leads','lead_calls','projects',
    'project_members','tasks','invoices','billing_lines','invoice_lines','invoice_taxes','invoice_sequences',
    'payments','refunds','sheets','time_entries','time_allocations','expenses','notifications','audit_log','backups'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

-- The app role can use every table; RLS decides which rows.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eszy_app') THEN
    GRANT USAGE ON SCHEMA public TO eszy_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO eszy_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO eszy_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eszy_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO eszy_app;
  END IF;
END $$;
