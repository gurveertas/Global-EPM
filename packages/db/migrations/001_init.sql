-- eszy schema. Money is stored in minor units (bigint). Time is stored in minutes (integer).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============ Platform layer (no row-level security) ============
CREATE TABLE plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  sort int NOT NULL DEFAULT 0,
  price_month_minor bigint NOT NULL DEFAULT 0,  -- per user
  price_year_minor bigint NOT NULL DEFAULT 0,   -- per user
  currency char(3) NOT NULL DEFAULT 'USD',
  max_users int,                                  -- null = no limit
  max_projects int,
  rate_limit_per_minute int NOT NULL DEFAULT 600,
  public boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE features (
  code text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT ''
);

CREATE TABLE plan_features (
  plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  feature_code text NOT NULL REFERENCES features(code) ON DELETE CASCADE,
  PRIMARY KEY (plan_id, feature_code)
);

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','past_due','read_only','suspended','cancelled')),
  plan_id uuid REFERENCES plans(id),
  trial_ends_at timestamptz,
  cancelled_at timestamptz,
  delete_after timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_features (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  feature_code text NOT NULL REFERENCES features(code) ON DELETE CASCADE,
  enabled boolean NOT NULL,                      -- add-on (true) or switched off (false)
  PRIMARY KEY (tenant_id, feature_code)
);

CREATE TABLE tenant_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  host text UNIQUE NOT NULL,
  kind text NOT NULL DEFAULT 'subdomain' CHECK (kind IN ('subdomain','custom')),
  verified boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES plans(id),
  provider text CHECK (provider IN ('stripe','razorpay','manual')),
  provider_customer_id text,
  provider_subscription_id text,
  interval text NOT NULL DEFAULT 'month' CHECK (interval IN ('month','year')),
  seats int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing','active','past_due','read_only','suspended','cancelled')),
  current_period_end timestamptz,
  payment_failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX subscriptions_tenant ON subscriptions(tenant_id);

CREATE TABLE subscription_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_invoice_id text,
  amount_minor bigint NOT NULL,
  tax_minor bigint NOT NULL DEFAULT 0,
  currency char(3) NOT NULL,
  status text NOT NULL,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Keys for Stripe, Razorpay, email etc. Secret values are encrypted by the API before saving.
CREATE TABLE platform_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sales_enquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, company text NOT NULL, email text NOT NULL,
  team_size text NOT NULL DEFAULT '', features text NOT NULL DEFAULT '', message text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============ Company layer (row-level security on every table) ============
CREATE TABLE company_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  permissions text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);

CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  lead_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  name text NOT NULL,
  password_hash text,
  google_sub text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','disabled')),
  is_owner boolean NOT NULL DEFAULT false,
  team_id uuid REFERENCES teams(id) ON DELETE SET NULL,
  phone text NOT NULL DEFAULT '',
  joined_on date,
  cost_per_hour_minor bigint,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);
ALTER TABLE teams ADD CONSTRAINT teams_lead_fk FOREIGN KEY (lead_user_id) REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE user_roles (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('invite','reset')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  date date NOT NULL,
  name text NOT NULL,
  UNIQUE (tenant_id, date)
);

CREATE TABLE leave_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  yearly_days numeric(5,1) NOT NULL DEFAULT 0,
  paid boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE leave_balances (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  leave_type_id uuid NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  year int NOT NULL,
  credited_days numeric(5,1) NOT NULL DEFAULT 0,
  used_days numeric(5,1) NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, leave_type_id, year)
);

CREATE TABLE leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  leave_type_id uuid NOT NULL REFERENCES leave_types(id),
  start_date date NOT NULL,
  end_date date NOT NULL,
  half_day boolean NOT NULL DEFAULT false,
  days numeric(5,1) NOT NULL,
  reason text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE TABLE wfh_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('full','half')),
  reason text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX wfh_one_active_per_day ON wfh_requests(user_id, date) WHERE status IN ('pending','approved');

CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  company text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  country text NOT NULL DEFAULT 'IN',
  state text NOT NULL DEFAULT '',
  tax_id text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  lead_id uuid,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title text NOT NULL,
  contact_name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  company text NOT NULL DEFAULT '',
  country text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  estimated_value_minor bigint,
  bringer_id uuid NOT NULL REFERENCES users(id),   -- who brought the lead; locked once set
  caller_id uuid REFERENCES users(id),             -- assigned pre-sales caller
  converter_id uuid REFERENCES users(id),          -- whoever logged the successful call
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','follow_up','converted','lost','onboarded')),
  next_follow_up_at timestamptz,
  converted_at timestamptz,
  client_id uuid REFERENCES clients(id),
  project_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE clients ADD CONSTRAINT clients_lead_fk FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;

CREATE TABLE lead_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  caller_id uuid NOT NULL REFERENCES users(id),
  outcome text NOT NULL CHECK (outcome IN ('no_answer','interested','not_interested','follow_up','converted')),
  notes text NOT NULL DEFAULT '',
  next_follow_up_at timestamptz,
  called_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id),
  name text NOT NULL,
  code text NOT NULL DEFAULT '',
  type text NOT NULL CHECK (type IN ('hourly','fixed')),
  billing_type text CHECK (billing_type IN ('prepaid','postpaid')),
  invoicing text NOT NULL DEFAULT 'one_time' CHECK (invoicing IN ('one_time','recurring')),
  fixed_option text CHECK (fixed_option IN ('one_time','milestones','installments','advance_balance')),
  price_minor bigint,
  hourly_rate_minor bigint,
  installment_count int,
  installment_interval text CHECK (installment_interval IN ('week','month')),
  advance_percent int,
  delivery_date date,
  billing_cap_minutes int,
  billing_period text CHECK (billing_period IN ('week','month')),
  billing_date date,                 -- prepaid: first invoice date; recurring: next run
  next_billing_date date,
  due_days int,
  due_soon_days int,                 -- null = use company setting
  due_soon_client_email boolean,     -- null = use company setting
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')),
  pm_user_id uuid REFERENCES users(id),
  sales_user_id uuid REFERENCES users(id),
  lead_id uuid REFERENCES leads(id),
  start_date date,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((type = 'hourly' AND billing_type IS NOT NULL) OR (type = 'fixed' AND fixed_option IS NOT NULL))
);
ALTER TABLE leads ADD CONSTRAINT leads_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;

CREATE TABLE project_members (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  assignee_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  number text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('fixed','prepaid','postpaid','extra','manual')),
  issue_date date NOT NULL,
  due_date date NOT NULL,
  currency char(3) NOT NULL,
  subtotal_minor bigint NOT NULL,
  tax_minor bigint NOT NULL DEFAULT 0,
  total_minor bigint NOT NULL,
  paid_minor bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','partially_paid','paid','refunded','cancelled')),
  period_start date,
  period_end date,
  notes text NOT NULL DEFAULT '',
  due_soon_notified_at timestamptz,
  overdue_notified_at timestamptz,
  cancelled_at timestamptz,
  refunded_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number)
);

CREATE TABLE billing_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 0,
  label text NOT NULL,
  minutes int NOT NULL CHECK (minutes >= 0),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  due_date date,
  kind text NOT NULL DEFAULT 'plan' CHECK (kind IN ('plan','extra')),
  billable boolean GENERATED ALWAYS AS (amount_minor > 0) STORED,
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  minutes int NOT NULL DEFAULT 0,
  amount_minor bigint NOT NULL,
  billing_line_id uuid REFERENCES billing_lines(id) ON DELETE SET NULL
);

CREATE TABLE invoice_taxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  name text NOT NULL,
  rate_bp int NOT NULL,              -- basis points: 1800 = 18%
  amount_minor bigint NOT NULL
);

CREATE TABLE invoice_sequences (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  next_value int NOT NULL DEFAULT 1
);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  received_on date NOT NULL,
  method text NOT NULL DEFAULT 'bank_transfer',
  reference text NOT NULL DEFAULT '',
  recorded_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL UNIQUE REFERENCES invoices(id) ON DELETE CASCADE,  -- one whole-invoice refund
  amount_minor bigint NOT NULL,
  refunded_on date NOT NULL,
  reason text NOT NULL DEFAULT '',
  recorded_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected')),
  submitted_at timestamptz,
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

CREATE TABLE time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sheet_id uuid NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  date date NOT NULL,
  minutes int NOT NULL CHECK (minutes > 0),
  description text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'eszy',     -- where the hours were tracked, e.g. 'eszy', 'Upwork'
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,  -- postpaid invoices link entries directly
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Approved hours are spread over billing lines in order; this records which line each minute used.
CREATE TABLE time_allocations (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
  billing_line_id uuid REFERENCES billing_lines(id) ON DELETE CASCADE,  -- null = no line (postpaid without lines)
  minutes int NOT NULL CHECK (minutes > 0)
);

CREATE TABLE expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  date date NOT NULL,
  description text NOT NULL,
  amount_minor bigint NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  link text NOT NULL DEFAULT '',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  data jsonb NOT NULL DEFAULT '{}',
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','failed')),
  object_key text,
  size_bytes bigint,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

-- Indexes
CREATE INDEX ON users(tenant_id);
CREATE INDEX ON leads(tenant_id, status);
CREATE INDEX ON leads(tenant_id, caller_id);
CREATE INDEX ON leads(tenant_id, bringer_id);
CREATE INDEX ON lead_calls(lead_id);
CREATE INDEX ON projects(tenant_id, status);
CREATE INDEX ON billing_lines(project_id, position);
CREATE INDEX ON invoices(tenant_id, status, due_date);
CREATE INDEX ON invoices(project_id);
CREATE INDEX ON payments(invoice_id);
CREATE INDEX ON sheets(tenant_id, date);
CREATE INDEX ON time_entries(project_id, date);
CREATE INDEX ON time_entries(user_id, date);
CREATE INDEX ON time_allocations(entry_id);
CREATE INDEX ON time_allocations(billing_line_id);
CREATE INDEX ON notifications(user_id, read_at);
CREATE INDEX ON audit_log(tenant_id, at DESC);
