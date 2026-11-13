-- Round 4: several Project Managers per project, project stages (board), project files and links,
-- per-person permission overrides.

-- Several PMs per project. projects.pm_user_id stays as the main PM (first one).
ALTER TABLE project_members DROP CONSTRAINT IF EXISTS project_members_role_check;
ALTER TABLE project_members ADD CONSTRAINT project_members_role_check CHECK (role IN ('pm','tl','member'));
UPDATE project_members m SET role = 'pm' FROM projects p WHERE p.id = m.project_id AND p.pm_user_id = m.user_id AND m.role = 'member';

-- Project stages: a company-defined workflow shown as the project board.
CREATE TABLE project_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  position int NOT NULL DEFAULT 0,
  is_done boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
ALTER TABLE projects ADD COLUMN stage_id uuid REFERENCES project_stages(id) ON DELETE SET NULL, ADD COLUMN stage_position int NOT NULL DEFAULT 0;

-- Files and links attached to a project.
CREATE TABLE project_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('file','link')),
  name text NOT NULL,
  url text,
  content_type text,
  size_bytes int,
  data bytea,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_files_project ON project_files (project_id, created_at DESC);

-- Per-person access: { "<module>": "hidden" | "view" | "edit" } on top of the person's roles.
ALTER TABLE users ADD COLUMN permission_overrides jsonb NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS sheets_decided ON sheets (decided_at);
CREATE INDEX IF NOT EXISTS time_entries_task ON time_entries (task_id) WHERE task_id IS NOT NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['project_stages','project_files'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eszy_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON project_stages, project_files TO eszy_app;
  END IF;
END $$;

-- Default stages for every existing company; projects start in the first one (ended projects in Complete).
INSERT INTO project_stages (tenant_id, name, position, is_done)
SELECT t.id, s.name, s.pos, s.done FROM tenants t
CROSS JOIN (VALUES ('To do', 1, false), ('In progress', 2, false), ('Awaiting feedback', 3, false), ('QA and review', 4, false), ('Complete', 5, true)) AS s(name, pos, done)
ON CONFLICT DO NOTHING;
UPDATE projects p SET stage_id = (SELECT id FROM project_stages s WHERE s.tenant_id = p.tenant_id AND s.name = CASE WHEN p.status = 'ended' THEN 'Complete' WHEN p.status = 'active' THEN 'In progress' ELSE 'To do' END)
WHERE stage_id IS NULL;
