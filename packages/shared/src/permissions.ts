/** Every permission a role can hold. The Permissions tab in company settings lists these. */
export const PERMISSIONS = {
  "dashboard.view": "See the dashboard",
  "users.view": "See people in the company",
  "users.manage": "Invite, edit and disable people",
  "roles.view": "See roles and who has which access",
  "roles.manage": "Edit roles and permissions",
  "teams.manage": "Create teams and set Team Leads",
  "settings.manage": "Change company settings",
  "masters.manage": "Manage masters: work types, sources, accounts, communication types and stages",
  "subscription.manage": "Manage the eszy plan and payment",
  "leads.view_all": "See every lead",
  "leads.create": "Create leads",
  "leads.assign": "Assign callers to any lead",
  "leads.manage": "Edit or delete any lead",
  "clients.view": "See clients",
  "clients.manage": "Create and edit clients",
  "projects.view_all": "See every project",
  "projects.manage": "Create and edit projects, members and status",
  "projects.billing": "Set up project billing and add extra hours",
  "projects.assign": "Assign Project Managers and Team Leads to projects",
  "tasks.manage": "Create and edit tasks",
  "time.own": "Fill in own daily sheet",
  "time.approve_team": "Approve sheets of own team",
  "time.approve_all": "Approve any sheet",
  "leave.request": "Request leave and WFH",
  "leave.approve_team": "Approve leave and WFH for own team",
  "leave.manage": "Manage leave types, credits, holidays and working days",
  "invoices.view": "See invoices",
  "invoices.manage": "Create, edit and cancel invoices",
  "payments.record": "Record payments on invoices",
  "refunds.manage": "Refund invoices",
  "money.view": "See amounts, rates, revenue and costs",
  "expenses.manage": "Record internal costs and expenses",
  "reports.view": "See reports",
  "performance.view": "See everyone's performance",
  "performance.view_team": "See own team's performance",
  "import_export": "Import and export CSV data",
  "audit.view": "See the change history",
  "assets.manage": "Manage accessories and who has them",
  "events.manage": "Add and edit calendar events",
  "standup.view_all": "See everyone's standups",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/** Default roles created for every new company. Companies can rename or change them. */
export const DEFAULT_ROLES: { key: string; name: string; permissions: Permission[] }[] = [
  { key: "admin", name: "Admin", permissions: ALL_PERMISSIONS },
  {
    key: "billing_manager",
    name: "Billing Manager",
    permissions: [
      "dashboard.view", "users.view", "clients.view", "clients.manage", "projects.view_all", "projects.billing", "projects.assign",
      "invoices.view", "invoices.manage", "payments.record", "refunds.manage", "money.view", "expenses.manage",
      "reports.view", "performance.view", "import_export", "time.own", "leave.request",
    ],
  },
  {
    key: "sales_tl",
    name: "Sales TL",
    permissions: [
      "dashboard.view", "users.view", "leads.view_all", "leads.create", "leads.assign", "leads.manage",
      "clients.view", "clients.manage", "projects.view_all", "projects.manage", "projects.assign", "time.own", "leave.request",
    ],
  },
  { key: "sales", name: "Salesperson", permissions: ["dashboard.view", "leads.create", "clients.view", "time.own", "leave.request"] },
  {
    key: "project_manager",
    name: "Project Manager",
    permissions: ["dashboard.view", "users.view", "clients.view", "projects.view_all", "projects.manage", "tasks.manage", "reports.view", "time.own", "leave.request", "standup.view_all"],
  },
  {
    key: "team_lead",
    name: "Team Lead",
    permissions: ["dashboard.view", "users.view", "time.approve_team", "leave.approve_team", "performance.view_team", "tasks.manage", "time.own", "leave.request"],
  },
  {
    key: "reporting_manager",
    name: "Reporting Manager",
    permissions: ["dashboard.view", "users.view", "time.approve_team", "leave.approve_team", "performance.view_team", "standup.view_all", "reports.view", "time.own", "leave.request"],
  },
  { key: "hr", name: "HR", permissions: ["dashboard.view", "users.view", "users.manage", "teams.manage", "roles.view", "leave.manage", "time.own", "leave.request", "reports.view", "assets.manage", "events.manage", "standup.view_all"] },
  { key: "employee", name: "Employee", permissions: ["dashboard.view", "time.own", "leave.request"] },
];

/** Features a plan can switch on. */
export const FEATURES = {
  people_time: "People and Time",
  projects_billing: "Projects and Billing",
  sales_crm: "Sales CRM",
  performance_rates: "Performance and Rates",
} as const;
export type Feature = keyof typeof FEATURES;

/**
 * Per-person access, shown as Hidden / View / Edit for each module. A person's roles give the starting point;
 * an override for a module replaces what the roles give for that module only.
 */
export type Access = "hidden" | "view" | "edit";
export type AccessModule = { key: string; group: string; label: string; info: string; view: Permission[]; edit: Permission[] };
export const ACCESS_MODULES: AccessModule[] = [
  { key: "dashboard", group: "Overview", label: "Dashboard", info: "The home page with money, hours and charts.", view: ["dashboard.view"], edit: [] },
  { key: "employees", group: "People", label: "Employee management", info: "View: see everyone's profile. Edit: add, edit and disable people.", view: ["users.view"], edit: ["users.manage"] },
  { key: "teams", group: "People", label: "Departments and teams", info: "Create teams and departments and set Team Leads.", view: [], edit: ["teams.manage"] },
  { key: "roles", group: "People", label: "Roles and permissions", info: "View: see roles and who has which access. Edit: change roles and other people's access.", view: ["roles.view"], edit: ["roles.manage"] },
  { key: "leads", group: "Sales", label: "Leads", info: "View: every lead. Edit: create, assign and edit any lead.", view: ["leads.view_all"], edit: ["leads.create", "leads.assign", "leads.manage"] },
  { key: "clients", group: "Projects", label: "Client master", info: "View: see clients. Edit: create and edit clients.", view: ["clients.view"], edit: ["clients.manage"] },
  { key: "projects", group: "Projects", label: "Projects", info: "View: every project. Edit: create projects and change their team, stage and status.", view: ["projects.view_all"], edit: ["projects.manage"] },
  { key: "assign", group: "Projects", label: "Project assignment", info: "Assign Project Managers and Team Leads to any project.", view: [], edit: ["projects.assign"] },
  { key: "tasks", group: "Projects", label: "Tasks", info: "Create, assign and edit tasks on projects.", view: [], edit: ["tasks.manage"] },
  { key: "project_billing", group: "Projects", label: "Project billing", info: "Billing lines, caps and extra hours.", view: [], edit: ["projects.billing"] },
  { key: "approve_team", group: "Timesheets", label: "Approve own team's sheets", info: "Approve or send back sheets of people who report to them.", view: [], edit: ["time.approve_team"] },
  { key: "approve_all", group: "Timesheets", label: "Approve any sheet", info: "Approve or send back anyone's sheet.", view: [], edit: ["time.approve_all"] },
  { key: "standups", group: "Timesheets", label: "Everyone's standups", info: "See standups and the morning report for everyone.", view: ["standup.view_all"], edit: [] },
  { key: "leave_team", group: "Leave", label: "Approve team leave", info: "Approve leave and WFH for people who report to them.", view: [], edit: ["leave.approve_team"] },
  { key: "leave_manage", group: "Leave", label: "Leave management", info: "Leave types, credits, holidays and working days.", view: [], edit: ["leave.manage"] },
  { key: "events", group: "Leave", label: "Event management", info: "Add and edit calendar events.", view: [], edit: ["events.manage"] },
  { key: "invoices", group: "Billing", label: "Invoices and payments", info: "View: see invoices. Edit: create, cancel and refund invoices and record payments.", view: ["invoices.view"], edit: ["invoices.manage", "payments.record", "refunds.manage"] },
  { key: "money", group: "Billing", label: "Amounts and rates", info: "View: see amounts, rates, revenue and costs. Edit: record expenses.", view: ["money.view"], edit: ["expenses.manage"] },
  { key: "reports", group: "Reports", label: "Reporting", info: "Team, sheet and leave reporting for everyone.", view: ["reports.view"], edit: [] },
  { key: "performance_team", group: "Reports", label: "Team performance", info: "Performance of the people who report to them.", view: ["performance.view_team"], edit: [] },
  { key: "performance_all", group: "Reports", label: "Everyone's performance", info: "Performance of everyone in the company.", view: ["performance.view"], edit: [] },
  { key: "import_export", group: "Company", label: "Import and export", info: "Import and export CSV and Excel data.", view: [], edit: ["import_export"] },
  { key: "assets", group: "Company", label: "Accessories", info: "Manage company accessories and who has them.", view: [], edit: ["assets.manage"] },
  { key: "audit", group: "Company", label: "Change history", info: "See who changed what.", view: ["audit.view"], edit: [] },
  { key: "masters", group: "Company", label: "Masters and onboarding", info: "Work types, onboarding sources and accounts, communication types and project stages.", view: [], edit: ["masters.manage"] },
  { key: "settings", group: "Company", label: "Company settings", info: "Branding and colours, work policies, tax, sign-in, the assistant, alerts and backups.", view: [], edit: ["settings.manage"] },
];

/** What a set of permissions gives for one module. Modules with only view permissions use hidden/view; with only edit permissions, hidden/edit. */
export function accessFor(m: AccessModule, perms: Iterable<string>): Access {
  const s = new Set(perms);
  if (m.edit.length && m.edit.every((p) => s.has(p))) return "edit";
  if (m.view.length && m.view.every((p) => s.has(p))) return "view";
  return "hidden";
}

/** Applies a person's overrides to the permissions their roles give. */
export function applyAccessOverrides(perms: Set<string>, overrides: Record<string, Access> | null | undefined) {
  for (const m of ACCESS_MODULES) {
    const o = overrides?.[m.key];
    if (!o) continue;
    if (o === "hidden" || (o === "view" && !m.view.length)) { for (const p of [...m.view, ...m.edit]) perms.delete(p); continue; }
    for (const p of m.view) perms.add(p);
    if (o === "edit") for (const p of m.edit) perms.add(p);
    else for (const p of m.edit) perms.delete(p);
  }
  return perms;
}
