-- Round 3: the rest of the old EPM, screen by screen.

-- ---------- employees ----------
ALTER TABLE users
  ADD COLUMN employee_code text NOT NULL DEFAULT '',
  ADD COLUMN employment_status text NOT NULL DEFAULT 'appointed' CHECK (employment_status IN ('provisional','appointed','notice','inactive')),
  ADD COLUMN inactive_from date,
  ADD COLUMN reporting_manager_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN designation text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX users_employee_code ON users(tenant_id, employee_code) WHERE employee_code <> '';
UPDATE users SET employment_status = CASE
  WHEN status = 'disabled' THEN 'inactive'
  WHEN notice_starts_on IS NOT NULL THEN 'notice'
  WHEN probation_ends_on IS NOT NULL AND probation_ends_on > current_date THEN 'provisional'
  ELSE 'appointed' END;

-- A team can have a reporting manager above its TL.
ALTER TABLE teams ADD COLUMN manager_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

-- ---------- clients ----------
ALTER TABLE clients
  ADD COLUMN client_type text NOT NULL DEFAULT 'direct' CHECK (client_type IN ('direct','upwork','other')),
  ADD COLUMN hiring_id text NOT NULL DEFAULT '',          -- e.g. the Upwork contract or client ID
  ADD COLUMN source_id uuid REFERENCES project_sources(id) ON DELETE SET NULL,
  ADD COLUMN account_id uuid REFERENCES project_accounts(id) ON DELETE SET NULL,
  ADD COLUMN communication_type_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN contact_name text NOT NULL DEFAULT '',
  ADD COLUMN website text NOT NULL DEFAULT '',
  ADD COLUMN preferred_billing text CHECK (preferred_billing IN ('hourly','fixed')),
  ADD COLUMN notes text NOT NULL DEFAULT '',
  ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'));

-- ---------- work types: billable, in-house or no work ----------
ALTER TABLE activity_types ADD COLUMN category text NOT NULL DEFAULT 'billable' CHECK (category IN ('billable','inhouse','no_work'));
UPDATE activity_types SET category = 'inhouse' WHERE name IN ('Meeting','Research');

-- ---------- projects ----------
ALTER TABLE projects
  ADD COLUMN is_internal boolean NOT NULL DEFAULT false,   -- the company's own work: always in-house hours
  ADD COLUMN estimator_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN caller_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN tags text[] NOT NULL DEFAULT '{}';
UPDATE projects SET is_internal = true WHERE coalesce(hourly_rate_minor, 1) = 0 AND type = 'hourly';
-- Who does what on a project: one PM (projects.pm_user_id), any number of TLs, and members.
ALTER TABLE project_members
  ADD COLUMN role text NOT NULL DEFAULT 'member' CHECK (role IN ('tl','member')),
  ADD COLUMN assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN assigned_at timestamptz NOT NULL DEFAULT now();

-- ---------- tasks ----------
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
UPDATE tasks SET status = 'todo' WHERE status = 'open';
ALTER TABLE tasks
  ADD CONSTRAINT tasks_status_check CHECK (status IN ('todo','in_progress','review','done')),
  ALTER COLUMN status SET DEFAULT 'todo',
  ADD COLUMN description text NOT NULL DEFAULT '',
  ADD COLUMN priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  ADD COLUMN due_date date,
  ADD COLUMN estimated_minutes int,
  ADD COLUMN links text[] NOT NULL DEFAULT '{}',
  ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- ---------- leave: half days (morning/afternoon) and short leave in hours ----------
ALTER TABLE leave_requests
  ADD COLUMN part text NOT NULL DEFAULT 'full' CHECK (part IN ('full','first_half','second_half','short')),
  ADD COLUMN short_minutes int;
UPDATE leave_requests SET part = 'first_half' WHERE half_day;
ALTER TABLE wfh_requests DROP CONSTRAINT IF EXISTS wfh_requests_kind_check;
ALTER TABLE wfh_requests ADD CONSTRAINT wfh_requests_kind_check CHECK (kind IN ('full','half','hours')), ADD COLUMN minutes int;
ALTER TABLE holidays ADD COLUMN kind text NOT NULL DEFAULT 'holiday' CHECK (kind IN ('holiday','non_working')), ADD COLUMN description text NOT NULL DEFAULT '';

-- ---------- accessories ----------
ALTER TABLE assets
  ADD COLUMN brand text NOT NULL DEFAULT '',
  ADD COLUMN vendor text NOT NULL DEFAULT '',
  ADD COLUMN warranty_months int;
CREATE TABLE asset_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('new','issue')),
  category text NOT NULL DEFAULT '',
  asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  details text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','rejected')),
  response text NOT NULL DEFAULT '',
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- company notes ----------
CREATE TABLE notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  body text NOT NULL,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','everyone')),
  pinned boolean NOT NULL DEFAULT false,
  color text NOT NULL DEFAULT 'plain',
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['asset_requests','notes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eszy_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON asset_requests, notes TO eszy_app;
  END IF;
END $$;

CREATE INDEX ON time_entries(user_id, date);
CREATE INDEX ON time_entries(project_id, date);
CREATE INDEX ON asset_requests(status, created_at DESC);
CREATE INDEX ON notes(created_by, updated_at DESC);
