-- A Reporting Manager role for every company: approves the sheets and leave of the people who report to them.
INSERT INTO roles (tenant_id, key, name, is_system, permissions)
SELECT t.id, 'reporting_manager', 'Reporting Manager', true,
  ARRAY['dashboard.view','users.view','time.approve_team','leave.approve_team','performance.view_team','standup.view_all','reports.view','time.own','leave.request']
FROM tenants t
ON CONFLICT (tenant_id, key) DO NOTHING;
