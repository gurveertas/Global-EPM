import { Router } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { stringify as stringifyStream } from "csv-stringify";
import ExcelJS from "exceljs";
import QueryStream from "pg-query-stream";
import { z } from "zod";
import { clientInputSchema, leadInputSchema } from "@eszy/shared";
import { creditLeave } from "@eszy/db";
import { can, h, userId } from "../lib/context";
import { requirePerm } from "../lib/auth";
import { badRequest, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { getSettings, maskSettings } from "../lib/settings";
import { enqueueTenantJob } from "../lib/queue";
import { dumpTenant, listBackupFiles, STORAGE_HINTS, testBackupTarget } from "../services/backups";

export const dataRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const uuid = z.string().uuid();

// ---------- CSV export ----------
const EXPORTS: Record<string, { sql: string; money?: string[]; perm?: string }> = {
  users: { sql: "SELECT u.name, u.email, u.status, t.name AS team, u.phone, u.joined_on, (SELECT string_agg(r.name, '; ') FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id) AS roles, u.cost_per_hour_minor FROM users u LEFT JOIN teams t ON t.id = u.team_id ORDER BY u.name", money: ["cost_per_hour_minor"] },
  clients: { sql: "SELECT name, company, email, phone, country, state, tax_id, address, created_at FROM clients ORDER BY name" },
  projects: { sql: "SELECT p.name, p.code, c.name AS client, p.type, p.billing_type, p.invoicing, p.fixed_option, p.status, p.price_minor, p.hourly_rate_minor, p.billing_cap_minutes, p.billing_period, p.due_days, p.start_date FROM projects p JOIN clients c ON c.id = p.client_id ORDER BY p.name", money: ["price_minor", "hourly_rate_minor"] },
  billing_lines: { sql: "SELECT p.name AS project, bl.label, bl.kind, bl.minutes, bl.amount_minor, bl.due_date, i.number AS invoice FROM billing_lines bl JOIN projects p ON p.id = bl.project_id LEFT JOIN invoices i ON i.id = bl.invoice_id ORDER BY p.name, bl.position", money: ["amount_minor"], perm: "money.view" },
  leads: { sql: "SELECT l.title, l.contact_name, l.email, l.phone, l.company, l.country, l.source, l.status, b.name AS bringer, c.name AS caller, v.name AS converter, l.created_at, l.converted_at FROM leads l JOIN users b ON b.id = l.bringer_id LEFT JOIN users c ON c.id = l.caller_id LEFT JOIN users v ON v.id = l.converter_id ORDER BY l.created_at DESC" },
  time: { sql: "SELECT e.date, u.name AS person, p.name AS project, t.title AS task, e.minutes, e.description, e.source, s.status FROM time_entries e JOIN users u ON u.id = e.user_id JOIN projects p ON p.id = e.project_id JOIN sheets s ON s.id = e.sheet_id LEFT JOIN tasks t ON t.id = e.task_id ORDER BY e.date DESC" },
  invoices: { sql: "SELECT i.number, i.kind, c.name AS client, p.name AS project, i.issue_date, i.due_date, i.currency, i.subtotal_minor, i.tax_minor, i.total_minor, i.paid_minor, i.status FROM invoices i JOIN clients c ON c.id = i.client_id JOIN projects p ON p.id = i.project_id ORDER BY i.issue_date DESC", money: ["subtotal_minor", "tax_minor", "total_minor", "paid_minor"], perm: "invoices.view" },
  payments: { sql: "SELECT i.number AS invoice, pm.received_on, pm.amount_minor, pm.method, pm.reference FROM payments pm JOIN invoices i ON i.id = pm.invoice_id ORDER BY pm.received_on DESC", money: ["amount_minor"], perm: "money.view" },
  holidays: { sql: "SELECT date, name FROM holidays ORDER BY date" },
};

dataRouter.get("/export/all", requirePerm("import_export"), h(async (req, db, res) => {
  if (!can(req, "money.view")) throw badRequest("A full export includes money, so only Admin and Billing Manager can run it");
  const dump = await dumpTenant(db);
  for (const u of dump.tables.users as any[]) { delete u.password_hash; delete u.totp_secret; }
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${req.tenant!.slug}-export.json"`);
  res.send(JSON.stringify(dump));
}));

/** Export any list as CSV (streamed row by row, so big lists don't load into memory) or as Excel (?format=xlsx). */
dataRouter.get("/export/:entity", requirePerm("import_export"), h(async (req, db, res) => {
  const name = String(req.params.entity).replace(/\.(csv|xlsx)$/, "");
  const format = String(req.query.format ?? (String(req.params.entity).endsWith(".xlsx") ? "xlsx" : "csv"));
  const ex = EXPORTS[name];
  if (!ex) throw notFound("Unknown export");
  if (ex.perm && !can(req, ex.perm as any)) throw badRequest("You can't export this list");
  const hideMoney = ex.money && !can(req, "money.view");
  const shape = (r: Record<string, unknown>) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      if (hideMoney && ex.money!.includes(k)) continue;
      if (k.endsWith("_minor")) o[k.replace(/_minor$/, "")] = v == null ? "" : Number(v) / 100;
      else if (k === "minutes" || k.endsWith("_minutes")) o[k.replace("minutes", "hours")] = v == null ? "" : Math.round((Number(v) / 60) * 100) / 100;
      else o[k] = v instanceof Date ? v.toISOString() : v;
    }
    return o;
  };
  const stream = db.query(new QueryStream(ex.sql, [], { batchSize: 500 })) as unknown as NodeJS.ReadableStream;
  if (format === "xlsx") {
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${name}.xlsx"`);
    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true });
    const ws = wb.addWorksheet(name);
    let first = true;
    for await (const row of stream as any) {
      const o = shape(row);
      if (first) { ws.columns = Object.keys(o).map((k) => ({ header: k.replace(/_/g, " "), key: k, width: 18 })); ws.getRow(1).font = { bold: true }; first = false; }
      ws.addRow(o).commit();
    }
    await wb.commit();
    return;
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}.csv"`);
  const csv = stringifyStream({ header: true });
  csv.pipe(res);
  for await (const row of stream as any) {
    if (!csv.write(shape(row))) await new Promise((r) => csv.once("drain", r));
  }
  csv.end();
  await new Promise((r) => res.on("finish", r));
}));

// ---------- CSV import ----------
/** Reads a Google Sheet shared as "Anyone with the link can view" as CSV. */
async function fetchGoogleSheet(url: string): Promise<Buffer> {
  const m = /docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(url);
  if (!m) throw badRequest("That isn't a Google Sheets link");
  const gid = /[#&?]gid=(\d+)/.exec(url)?.[1];
  const r = await fetch(`https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${gid}` : ""}`, { redirect: "follow" }).catch(() => null);
  if (!r || !r.ok || !(r.headers.get("content-type") ?? "").includes("csv")) throw badRequest("Couldn't read the sheet. Share it as \"Anyone with the link can view\" and try again.");
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 5 * 1024 * 1024) throw badRequest("The sheet is bigger than 5 MB");
  return buf;
}
const IMPORT_TEMPLATES: Record<string, string[]> = {
  users: ["name", "email", "employee_code", "role", "team", "department", "designation", "phone", "joined_on", "employment_status", "reporting_manager_email"],
  clients: ["name", "company", "email", "phone", "country", "state", "tax_id", "address", "client_type", "hiring_id", "contact_name", "website"],
  leads: ["title", "contact_name", "email", "phone", "company", "country", "source", "notes"],
  holidays: ["date", "name"],
  time: ["date", "email", "project", "hours", "description", "source"],
  teams: ["name", "team_lead_email", "department"],
  projects: ["name", "client", "type", "billing_type", "invoicing", "hourly_rate", "fixed_price", "billing_cap_hours", "billing_period", "due_days", "start_date", "members"],
  billing_lines: ["project", "label", "hours", "amount", "date"],
  tasks: ["project", "title", "assignee_email", "status"],
  leave_balances: ["email", "leave_type", "year", "credited_days", "used_days"],
};
dataRouter.get("/import/templates/:entity", requirePerm("import_export"), h(async (req, _db, res) => {
  const cols = IMPORT_TEMPLATES[String(req.params.entity)];
  if (!cols) throw notFound();
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${req.params.entity}-template.csv"`);
  res.send(cols.join(",") + "\n");
}));

dataRouter.post("/import/:entity", requirePerm("import_export"), upload.single("file"), h(async (req, db) => {
  const entity = z.enum(["users", "clients", "leads", "holidays", "time", "teams", "projects", "billing_lines", "tasks", "leave_balances"]).parse(req.params.entity);
  let buffer = req.file?.buffer;
  if (!buffer && req.body?.sheetUrl) buffer = await fetchGoogleSheet(String(req.body.sheetUrl));
  if (!buffer) throw badRequest("Attach a CSV file or paste a Google Sheet link");
  const dryRun = req.query.dryRun === "1";
  const rows: Record<string, string>[] = parse(buffer, { columns: (h: string[]) => h.map((x) => x.trim().toLowerCase()), skip_empty_lines: true, trim: true, bom: true });
  if (rows.length > 5000) throw badRequest("Import up to 5,000 rows at a time");
  const errors: { row: number; message: string }[] = [];
  let created = 0;
  const tid = req.tenant!.id;
  const roles = (await db.query("SELECT id, key, lower(name) AS name FROM roles")).rows;
  const teams = (await db.query("SELECT id, lower(name) AS name FROM teams")).rows;
  const projects = (await db.query("SELECT id, lower(name) AS name FROM projects")).rows;
  const users = (await db.query("SELECT id, email FROM users")).rows;
  const clients = (await db.query("SELECT id, lower(name) AS name, lower(company) AS company FROM clients")).rows;
  const depts = (await db.query("SELECT id, lower(name) AS name FROM departments")).rows;
  const leaveTypes = (await db.query("SELECT id, lower(name) AS name FROM leave_types")).rows;
  const userBy = (email?: string) => users.find((x) => x.email === (email ?? "").trim().toLowerCase());
  const projectBy = (n?: string) => projects.find((x) => x.name === (n ?? "").trim().toLowerCase());
  const money = (v?: string) => (v && v.trim() ? Math.round(Number(v.replace(/,/g, "")) * 100) : null);
  for (const [i, r] of rows.entries()) {
    const n = i + 2; // header is line 1
    await db.query("SAVEPOINT row_sp");
    try {
      if (entity === "users") {
        if (!can(req, "users.manage")) throw new Error("You can't add people");
        if (!r.email || !r.name) throw new Error("name and email are required");
        const role = roles.find((x) => x.key === (r.role ?? "").toLowerCase() || x.name === (r.role ?? "").toLowerCase()) ?? roles.find((x) => x.key === "employee");
        const team = teams.find((x) => x.name === (r.team ?? "").toLowerCase());
        if (!dryRun) {
          const dept = depts.find((d) => d.name === (r.department ?? "").toLowerCase());
          const mgr = r.reporting_manager_email ? userBy(r.reporting_manager_email) : null;
          const es = (r.employment_status ?? "").toLowerCase();
          const u = (await db.query(
            `INSERT INTO users (tenant_id, email, name, status, team_id, phone, joined_on, employee_code, department_id, designation, employment_status, reporting_manager_id)
             VALUES ($1, lower($2), $3, 'invited', $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id, email`,
            [tid, r.email, r.name, team?.id ?? null, r.phone ?? "", r.joined_on || null, r.employee_code ?? "", dept?.id ?? null, r.designation ?? "",
              ["provisional", "appointed", "notice", "inactive"].includes(es) ? es : "appointed", mgr?.id ?? null])).rows[0];
          users.push(u);
          await db.query("INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES ($1,$2,$3)", [tid, u.id, role.id]);
          await creditLeave(db, tid, u.id);
        }
      } else if (entity === "clients") {
        if (!can(req, "clients.manage")) throw new Error("You can't add clients");
        const ct = (r.client_type ?? "").toLowerCase();
        const c = clientInputSchema.parse({ name: r.name, company: r.company, email: r.email, phone: r.phone, country: r.country || "IN", state: r.state, taxId: r.tax_id, address: r.address,
          clientType: ["direct", "upwork", "other"].includes(ct) ? ct : "direct", hiringId: r.hiring_id ?? "", contactName: r.contact_name ?? "", website: r.website ?? "" });
        if (!dryRun) await db.query("INSERT INTO clients (tenant_id, name, company, email, phone, country, state, tax_id, address, created_by, client_type, hiring_id, contact_name, website) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)", [tid, c.name, c.company, c.email, c.phone, c.country, c.state, c.taxId, c.address, userId(req), c.clientType, c.hiringId, c.contactName, c.website]);
      } else if (entity === "leads") {
        if (!can(req, "leads.create")) throw new Error("You can't add leads");
        const l = leadInputSchema.parse({ title: r.title, contactName: r.contact_name, email: r.email, phone: r.phone, company: r.company, country: r.country, source: r.source, notes: r.notes });
        if (!dryRun) await db.query("INSERT INTO leads (tenant_id, title, contact_name, email, phone, company, country, source, notes, bringer_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [tid, l.title, l.contactName, l.email, l.phone, l.company, l.country, l.source, l.notes, userId(req)]);
      } else if (entity === "holidays") {
        if (!can(req, "leave.manage")) throw new Error("You can't add holidays");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date ?? "") || !r.name) throw new Error("date (YYYY-MM-DD) and name are required");
        if (!dryRun) await db.query("INSERT INTO holidays (tenant_id, date, name) VALUES ($1,$2,$3) ON CONFLICT (tenant_id, date) DO UPDATE SET name = EXCLUDED.name", [tid, r.date, r.name]);
      } else if (entity === "teams") {
        if (!can(req, "teams.manage")) throw new Error("You can't add teams");
        if (!r.name) throw new Error("name is required");
        const lead = r.team_lead_email ? userBy(r.team_lead_email) : null;
        if (r.team_lead_email && !lead) throw new Error(`No person with email ${r.team_lead_email}`);
        const dept = depts.find((d) => d.name === (r.department ?? "").toLowerCase());
        if (!dryRun) {
          const t = (await db.query("INSERT INTO teams (tenant_id, name, lead_user_id, department_id) VALUES ($1,$2,$3,$4) RETURNING id, lower(name) AS name", [tid, r.name, lead?.id ?? null, dept?.id ?? null])).rows[0];
          teams.push(t);
          if (lead) await db.query("UPDATE users SET team_id = coalesce(team_id, $1) WHERE id = $2", [t.id, lead.id]);
        }
      } else if (entity === "projects") {
        if (!can(req, "projects.manage") && !can(req, "projects.billing")) throw new Error("You can't add projects");
        const client = clients.find((c) => c.name === (r.client ?? "").toLowerCase() || c.company === (r.client ?? "").toLowerCase());
        if (!r.name || !client) throw new Error("name and a known client are required");
        const type = (r.type || "hourly").toLowerCase();
        if (!["hourly", "fixed"].includes(type)) throw new Error("type is hourly or fixed");
        const billingType = type === "hourly" ? (r.billing_type || "postpaid").toLowerCase() : null;
        if (billingType && !["prepaid", "postpaid"].includes(billingType)) throw new Error("billing_type is prepaid or postpaid");
        const capMin = r.billing_cap_hours ? Math.round(Number(r.billing_cap_hours) * 60) : null;
        if (!dryRun) {
          // Imported projects don't create invoices; add billing lines with the billing_lines import.
          const p = (await db.query(
            `INSERT INTO projects (tenant_id, client_id, name, type, billing_type, invoicing, fixed_option, price_minor, hourly_rate_minor, billing_cap_minutes, billing_period, due_days, start_date, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id, lower(name) AS name`,
            [tid, client.id, r.name, type, billingType, (r.invoicing || "one_time").toLowerCase(), type === "fixed" ? "milestones" : null, type === "fixed" ? money(r.fixed_price) : null,
              type === "hourly" ? (money(r.hourly_rate) ?? 0) : null, capMin, capMin ? (r.billing_period || "week").toLowerCase() : null, r.due_days ? Number(r.due_days) : null, r.start_date || null, userId(req)],
          )).rows[0];
          projects.push(p);
          for (const email of (r.members ?? "").split(/[;|]/).map((x) => x.trim()).filter(Boolean)) {
            const u = userBy(email);
            if (u) await db.query("INSERT INTO project_members (tenant_id, project_id, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [tid, p.id, u.id]);
          }
        }
      } else if (entity === "billing_lines") {
        if (!can(req, "projects.billing")) throw new Error("You can't add billing lines");
        const p = projectBy(r.project);
        const minutes = Math.round(Number(r.hours) * 60);
        if (!p || !r.label || !(minutes >= 0)) throw new Error("a known project, label and hours are required");
        if (!dryRun) {
          const pos = (await db.query("SELECT coalesce(max(position),0)+1 AS n FROM billing_lines WHERE project_id = $1", [p.id])).rows[0].n;
          await db.query("INSERT INTO billing_lines (tenant_id, project_id, position, label, minutes, amount_minor, due_date, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [tid, p.id, pos, r.label, minutes, money(r.amount) ?? 0, r.date || null, userId(req)]);
        }
      } else if (entity === "tasks") {
        if (!can(req, "tasks.manage") && !can(req, "projects.manage")) throw new Error("You can't add tasks");
        const p = projectBy(r.project);
        if (!p || !r.title) throw new Error("a known project and title are required");
        const a = r.assignee_email ? userBy(r.assignee_email) : null;
        if (!dryRun) await db.query("INSERT INTO tasks (tenant_id, project_id, title, assignee_id, status) VALUES ($1,$2,$3,$4,$5)", [tid, p.id, r.title, a?.id ?? null, r.status?.toLowerCase() === "done" ? "done" : "todo"]);
      } else if (entity === "leave_balances") {
        if (!can(req, "leave.manage")) throw new Error("You can't change leave balances");
        const u = userBy(r.email);
        const lt = leaveTypes.find((x) => x.name === (r.leave_type ?? "").toLowerCase());
        if (!u || !lt || !/^\d{4}$/.test(r.year ?? "")) throw new Error("a known email, leave type and year are required");
        if (!dryRun) {
          await db.query(
            `INSERT INTO leave_balances (tenant_id, user_id, leave_type_id, year, credited_days, used_days) VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (user_id, leave_type_id, year) DO UPDATE SET credited_days = EXCLUDED.credited_days, used_days = EXCLUDED.used_days`,
            [tid, u.id, lt.id, Number(r.year), Number(r.credited_days || 0), Number(r.used_days || 0)],
          );
        }
      } else if (entity === "time") {
        // Historic hours (e.g. from another tracker). They come in as approved, without cap checks.
        if (!can(req, "time.approve_all")) throw new Error("Only Admins can import hours");
        const u = users.find((x) => x.email === (r.email ?? "").toLowerCase());
        const p = projects.find((x) => x.name === (r.project ?? "").toLowerCase());
        const minutes = Math.round(Number(r.hours) * 60);
        if (!u || !p || !/^\d{4}-\d{2}-\d{2}$/.test(r.date ?? "") || !(minutes > 0)) throw new Error("date, a known email, a known project and hours are required");
        if (!dryRun) {
          await db.query("INSERT INTO sheets (tenant_id, user_id, date, status, submitted_at, decided_by, decided_at) VALUES ($1,$2,$3,'approved',now(),$4,now()) ON CONFLICT (user_id, date) DO NOTHING", [tid, u.id, r.date, userId(req)]);
          const sh = (await db.query("SELECT id FROM sheets WHERE user_id = $1 AND date = $2", [u.id, r.date])).rows[0];
          const e = (await db.query("INSERT INTO time_entries (tenant_id, sheet_id, user_id, project_id, date, minutes, description, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *", [tid, sh.id, u.id, p.id, r.date, minutes, r.description ?? "", r.source || "import"])).rows[0];
          const { allocateEntry } = await import("../services/time");
          await allocateEntry(db, e);
        }
      }
      await db.query("RELEASE SAVEPOINT row_sp");
      created++;
    } catch (e: any) {
      await db.query("ROLLBACK TO SAVEPOINT row_sp");
      errors.push({ row: n, message: e?.issues?.[0]?.message ?? (e?.code === "23505" ? "Already exists" : e.message) });
    }
  }
  if (!dryRun) await audit(db, req, "import", entity, null, { created, errors: errors.length });
  return { dryRun, rows: rows.length, created, errors };
}));

// ---------- backups to the company's own storage ----------
dataRouter.get("/backups", requirePerm("settings.manage"), h(async (_req, db) => (await db.query("SELECT * FROM backups ORDER BY started_at DESC LIMIT 50")).rows));
dataRouter.post("/backups/run", requirePerm("settings.manage"), h(async (req, db) => {
  const s = await getSettings(db);
  if (!s.backups.bucket || !s.backups.accessKeyId) throw badRequest("Add your storage keys in Settings, Backups first");
  await enqueueTenantJob("backup", req.tenant!.id, {}, `backup-${req.tenant!.id}-${Date.now()}`);
  return { ok: true, message: "Backup started. It appears in the list when it's done." };
}));
dataRouter.get("/backups/files", requirePerm("settings.manage"), h(async (req, db) => {
  const s = await getSettings(db);
  return { files: await listBackupFiles(s.backups, req.tenant!.slug), hints: STORAGE_HINTS };
}));
dataRouter.get("/backups/restores", requirePerm("settings.manage"), h(async (_req, db) => (await db.query("SELECT * FROM restores ORDER BY started_at DESC LIMIT 20")).rows));
/** Restore replaces all of this company's data with the backup. The Admin types the company address to confirm. */
dataRouter.post("/backups/restore", requirePerm("settings.manage"), h(async (req, db) => {
  const b = z.object({ key: z.string().min(5), confirm: z.string() }).parse(req.body);
  if (b.confirm !== req.tenant!.slug) throw badRequest(`Type ${req.tenant!.slug} to confirm`);
  if (!b.key.startsWith(`eszy-backups/${req.tenant!.slug}/`)) throw badRequest("Pick one of this company's backups");
  const r = (await db.query("INSERT INTO restores (tenant_id, object_key, requested_by) VALUES ($1,$2,$3) RETURNING id", [req.tenant!.id, b.key, userId(req)])).rows[0];
  await audit(db, req, "backup.restore", "backup", r.id, { key: b.key });
  await enqueueTenantJob("restore", req.tenant!.id, { key: b.key, restoreId: r.id }, `restore-${r.id}`);
  return { ok: true, restoreId: r.id, message: "Restore started. Everyone will need to sign in again when it's done." };
}));
dataRouter.post("/backups/test", requirePerm("settings.manage"), h(async (_req, db) => {
  const s = await getSettings(db);
  await testBackupTarget(s.backups);
  return { ok: true, message: "eszy could write to your bucket.", settings: maskSettings(s).backups };
}));
void uuid;
