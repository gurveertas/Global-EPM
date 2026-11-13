-- Who was PM or Team Lead of a project, and when, so handing a project over never loses its history.
CREATE TABLE project_role_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('pm','tl')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  handed_to uuid REFERENCES users(id) ON DELETE SET NULL,
  handover_id uuid
);
CREATE INDEX project_role_history_project ON project_role_history (project_id, started_at DESC);
INSERT INTO project_role_history (tenant_id, project_id, user_id, role, started_at)
SELECT m.tenant_id, m.project_id, m.user_id, m.role, m.assigned_at FROM project_members m WHERE m.role IN ('pm','tl');

-- A handover moves one person's responsibilities (projects as PM or TL, teams, direct reports, open tasks, leads) to another.
CREATE TABLE handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  moved jsonb NOT NULL DEFAULT '{}',
  note text NOT NULL DEFAULT '',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Hours a project without a billing cap has to share out between its tasks.
ALTER TABLE projects ADD COLUMN task_budget_minutes int CHECK (task_budget_minutes IS NULL OR task_budget_minutes >= 0);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['project_role_history','handovers'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eszy_app') THEN EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO eszy_app', t); END IF;
  END LOOP;
END $$;
