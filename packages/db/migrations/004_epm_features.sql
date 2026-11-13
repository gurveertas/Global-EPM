-- Round 2: features carried over from the current EPM, and the remaining architecture items.

-- ---------- people ----------
CREATE TABLE departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  head_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
ALTER TABLE teams ADD COLUMN department_id uuid REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE users
  ADD COLUMN department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  ADD COLUMN address text NOT NULL DEFAULT '',
  ADD COLUMN emergency_contact_name text NOT NULL DEFAULT '',
  ADD COLUMN emergency_contact_phone text NOT NULL DEFAULT '',
  ADD COLUMN date_of_birth date,
  ADD COLUMN has_photo boolean NOT NULL DEFAULT false,
  ADD COLUMN probation_ends_on date,
  ADD COLUMN notice_starts_on date,
  ADD COLUMN last_working_day date,
  ADD COLUMN totp_secret text,               -- encrypted; set when two-factor is on
  ADD COLUMN totp_enabled boolean NOT NULL DEFAULT false;

-- Small files kept in the database (profile photos). Keeps each company's files under row-level security.
CREATE TABLE user_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('photo')),
  content_type text NOT NULL,
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind)
);

ALTER TABLE platform_admins ADD COLUMN totp_secret text, ADD COLUMN totp_enabled boolean NOT NULL DEFAULT false;

-- ---------- leave policies ----------
ALTER TABLE leave_types
  ADD COLUMN accrual text NOT NULL DEFAULT 'yearly' CHECK (accrual IN ('yearly','monthly')),
  ADD COLUMN carry_forward_max numeric(5,1) NOT NULL DEFAULT 0,
  ADD COLUMN allowed_in_probation boolean NOT NULL DEFAULT true,
  ADD COLUMN allowed_in_notice boolean NOT NULL DEFAULT true,
  ADD COLUMN max_per_request numeric(5,1);
ALTER TABLE leave_balances ADD COLUMN carried_days numeric(5,1) NOT NULL DEFAULT 0, ADD COLUMN accrued_through date;
ALTER TABLE leave_requests ADD COLUMN sandwich_days numeric(5,1) NOT NULL DEFAULT 0, ADD COLUMN unpaid_days numeric(5,1) NOT NULL DEFAULT 0;

-- ---------- lookups (company-defined lists) ----------
CREATE TABLE communication_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL, active boolean NOT NULL DEFAULT true, UNIQUE (tenant_id, name)
);
CREATE TABLE project_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL, active boolean NOT NULL DEFAULT true, UNIQUE (tenant_id, name)        -- e.g. Upwork, Direct, Referral
);
CREATE TABLE project_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_id uuid REFERENCES project_sources(id) ON DELETE SET NULL,
  name text NOT NULL, profile_url text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true  -- e.g. an Upwork agency account
);
CREATE TABLE activity_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL, active boolean NOT NULL DEFAULT true, UNIQUE (tenant_id, name)        -- work type on a sheet entry
);
ALTER TABLE projects
  ADD COLUMN source_id uuid REFERENCES project_sources(id) ON DELETE SET NULL,
  ADD COLUMN account_id uuid REFERENCES project_accounts(id) ON DELETE SET NULL,
  ADD COLUMN communication_type_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN allow_offline_hours boolean NOT NULL DEFAULT true,
  ADD COLUMN description text NOT NULL DEFAULT '';
-- Tracking IDs: a contract or tracker ID on a project (e.g. an Upwork contract), picked on each sheet entry.
CREATE TABLE project_trackers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  account_id uuid REFERENCES project_accounts(id) ON DELETE SET NULL,
  label text NOT NULL, external_id text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true
);
ALTER TABLE time_entries
  ADD COLUMN activity_type_id uuid REFERENCES activity_types(id) ON DELETE SET NULL,
  ADD COLUMN tracker_id uuid REFERENCES project_trackers(id) ON DELETE SET NULL,
  ADD COLUMN offline boolean NOT NULL DEFAULT false,           -- worked but not tracked in the client's tracker
  ADD COLUMN offline_reason text NOT NULL DEFAULT '';

-- ---------- project notes, comments, activity ----------
CREATE TABLE project_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL, body text NOT NULL DEFAULT '', pinned boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  body text NOT NULL, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (project_id IS NOT NULL OR task_id IS NOT NULL OR client_id IS NOT NULL)
);

-- ---------- standup ----------
CREATE TABLE standups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date date NOT NULL,
  yesterday text NOT NULL DEFAULT '', today text NOT NULL DEFAULT '', blockers text NOT NULL DEFAULT '',
  project_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

-- ---------- backdated sheet requests ----------
CREATE TABLE sheet_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date date NOT NULL, reason text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','used','cancelled')),
  decided_by uuid REFERENCES users(id), decided_at timestamptz, expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sheet_requests_open ON sheet_requests(user_id, date) WHERE status IN ('pending','approved');

-- ---------- events calendar ----------
CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title text NOT NULL, description text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'event' CHECK (kind IN ('event','meeting','celebration','training','other')),
  start_date date NOT NULL, end_date date NOT NULL, start_time time, end_time time,
  audience text NOT NULL DEFAULT 'everyone' CHECK (audience IN ('everyone','team','department')),
  team_id uuid REFERENCES teams(id) ON DELETE CASCADE, department_id uuid REFERENCES departments(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
ALTER TABLE holidays ADD COLUMN half_day boolean NOT NULL DEFAULT false;

-- ---------- accessories (company assets) ----------
CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL, category text NOT NULL DEFAULT '', serial_number text NOT NULL DEFAULT '',
  purchased_on date, cost_minor bigint, condition text NOT NULL DEFAULT 'good' CHECK (condition IN ('new','good','fair','damaged','retired')),
  notes text NOT NULL DEFAULT '', assigned_to uuid REFERENCES users(id) ON DELETE SET NULL, assigned_on date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE asset_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_on date NOT NULL, returned_on date, condition_on_return text, notes text NOT NULL DEFAULT ''
);

-- ---------- invoices ----------
ALTER TABLE invoices ADD COLUMN cancel_reason text, ADD COLUMN corrects_invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL;
ALTER TABLE sheets ADD COLUMN reminder_sent_at timestamptz;
ALTER TABLE subscription_invoices
  ADD COLUMN number text, ADD COLUMN subtotal_minor bigint, ADD COLUMN taxes jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN period_start date, ADD COLUMN period_end date, ADD COLUMN bill_to jsonb NOT NULL DEFAULT '{}';
CREATE TABLE subscription_invoice_seq (id int PRIMARY KEY DEFAULT 1, next_value int NOT NULL DEFAULT 1);
INSERT INTO subscription_invoice_seq VALUES (1, 1);

-- ---------- notification rules ----------
CREATE TABLE alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event text NOT NULL,                       -- e.g. invoice.overdue, project.near_cap, sheet.submitted
  threshold int,                             -- e.g. 80 (%), 3 (days)
  role_keys text[] NOT NULL DEFAULT '{}', user_ids uuid[] NOT NULL DEFAULT '{}',
  notify_owner boolean NOT NULL DEFAULT false, -- the project's PM, the person's TL, etc.
  in_app boolean NOT NULL DEFAULT true, email boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE alert_log (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  key text NOT NULL, at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rule_id, key)
);

CREATE TABLE restores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  object_key text NOT NULL, status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','failed')),
  error text, requested_by uuid, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);

CREATE INDEX ON comments(project_id, created_at DESC);
CREATE INDEX ON comments(task_id);
CREATE INDEX ON events(tenant_id, start_date);
CREATE INDEX ON standups(tenant_id, date);
CREATE INDEX ON assets(tenant_id, assigned_to);
CREATE INDEX ON audit_log(tenant_id, entity, entity_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['departments','user_files','communication_types','project_sources','project_accounts','activity_types',
    'project_trackers','project_notes','comments','standups','sheet_requests','events','assets','asset_assignments','alert_rules','alert_log','restores'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eszy_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO eszy_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO eszy_app;
  END IF;
END $$;
