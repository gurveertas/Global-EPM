-- Vendors: where accessories are bought from, kept as a list with contact details.
CREATE TABLE vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  contact_name text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '', email text NOT NULL DEFAULT '',
  tax_id text NOT NULL DEFAULT '', address text NOT NULL DEFAULT '', website text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
ALTER TABLE assets ADD COLUMN vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL;

-- Existing free-text vendors become vendor records.
INSERT INTO vendors (tenant_id, name)
SELECT DISTINCT tenant_id, trim(vendor) FROM assets WHERE trim(coalesce(vendor, '')) <> ''
ON CONFLICT DO NOTHING;
UPDATE assets a SET vendor_id = v.id FROM vendors v WHERE v.tenant_id = a.tenant_id AND v.name = trim(a.vendor) AND a.vendor_id IS NULL;

ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON vendors
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eszy_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON vendors TO eszy_app;
  END IF;
END $$;
