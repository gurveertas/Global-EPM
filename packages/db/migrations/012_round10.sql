-- Round 10: refunded and cancelled hours in reporting, and indexes for large timesheet lists.
-- Hours from a cancelled invoice remember it until they're invoiced again, so reports can show "cancelled" hours.
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS cancelled_invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL;
ALTER TABLE billing_lines ADD COLUMN IF NOT EXISTS cancelled_invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL;
-- Reports filter and page by date, person and project; keep those fast as the data grows.
CREATE INDEX IF NOT EXISTS time_entries_tenant_date ON time_entries (tenant_id, date DESC);
CREATE INDEX IF NOT EXISTS time_entries_user_date ON time_entries (user_id, date);
CREATE INDEX IF NOT EXISTS time_entries_project_date ON time_entries (project_id, date);
CREATE INDEX IF NOT EXISTS time_entries_invoice ON time_entries (invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_log_tenant_id ON audit_log (tenant_id, id DESC);
