-- Round 6: masters and roles get their own permissions.
-- Anyone who could change settings (or edit projects, which could add masters inline) can manage masters;
-- anyone who could edit roles can see them; HR can see roles.
UPDATE roles SET permissions = array_append(permissions, 'masters.manage')
 WHERE ('settings.manage' = ANY(permissions) OR key = 'admin') AND NOT ('masters.manage' = ANY(permissions));
UPDATE roles SET permissions = array_append(permissions, 'roles.view')
 WHERE ('roles.manage' = ANY(permissions) OR key IN ('admin', 'hr')) AND NOT ('roles.view' = ANY(permissions));
-- Per-person overrides that hid or gave "settings" also covered masters before.
UPDATE users SET permission_overrides = permission_overrides || jsonb_build_object('masters', permission_overrides->'settings')
 WHERE permission_overrides ? 'settings' AND NOT permission_overrides ? 'masters';
