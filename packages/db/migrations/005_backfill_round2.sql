-- Gives companies created before round 2 the new permissions and default lists.
UPDATE roles SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['assets.manage','events.manage','standup.view_all'])) WHERE key = 'admin';
UPDATE roles SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['assets.manage','events.manage','standup.view_all'])) WHERE key = 'hr' AND is_system;
UPDATE roles SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['standup.view_all'])) WHERE key = 'project_manager' AND is_system;
INSERT INTO project_sources (tenant_id, name) SELECT t.id, n FROM tenants t, unnest(ARRAY['Upwork','Direct','Referral','Freelancer','Fiverr']) n ON CONFLICT DO NOTHING;
INSERT INTO communication_types (tenant_id, name) SELECT t.id, n FROM tenants t, unnest(ARRAY['Email','Slack','WhatsApp','Phone','Upwork messages','Google Meet','Zoom']) n ON CONFLICT DO NOTHING;
INSERT INTO activity_types (tenant_id, name) SELECT t.id, n FROM tenants t, unnest(ARRAY['Development','Design','Testing','Code review','Meeting','Research','Bug fix','Support','Deployment']) n ON CONFLICT DO NOTHING;
