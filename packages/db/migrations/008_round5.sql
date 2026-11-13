-- Round 5: who can assign people to projects, the Astra assistant (settings, keys, conversations).

-- Assigning PMs and Team Leads to projects belongs to Admin, Billing Manager and the sales team.
UPDATE roles SET permissions = array_append(permissions, 'projects.assign')
WHERE key IN ('admin', 'billing_manager', 'sales_tl') AND NOT ('projects.assign' = ANY(permissions));

-- One LLM key per provider per company, stored encrypted; only the last four characters are ever shown.
CREATE TABLE ai_keys (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('openai', 'anthropic', 'gemini')),
  key_enc text NOT NULL,
  last4 text NOT NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, provider)
);

-- Conversations with the assistant, per person. Pending actions wait here until the person confirms them.
CREATE TABLE ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content text NOT NULL DEFAULT '',
  data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_messages_conv ON ai_messages (user_id, conversation_id, created_at);

CREATE TABLE ai_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  tool text NOT NULL,
  args jsonb NOT NULL,
  summary text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'declined', 'failed')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_keys','ai_messages','ai_actions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eszy_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ai_keys, ai_messages, ai_actions TO eszy_app;
  END IF;
END $$;
