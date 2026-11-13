// Fills the demo company with about three months of realistic activity, so every screen has something to show:
// people and teams, clients, projects of every billing type, daily sheets, approvals, invoices, payments, refunds,
// leads and calls, leave and WFH, standups, calendar, accessories, notes, alerts, and the platform console.
//
// Usage: API running in development mode, then `pnpm demo` (or `docker compose -f docker-compose.dev.yml run --rm demo`).
// Most data goes through the API so every business rule applies. A few things the API only does "today"
// (dating past invoices, leads and approvals) are back-dated with SQL at the end.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

// ---------------------------------------------------------------- setup
for (let dir = process.cwd(), i = 0; i < 5; i++, dir = path.dirname(dir)) {
  const f = path.join(dir, ".env");
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  break;
}
const API = process.env.API_URL ?? "http://localhost:4000/api/v1";
const DB_URL = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
const T = "demo";
const H = 60;
const log = (...a) => console.log("•", ...a);

let waitedNote = false;
async function call(method, p, token, body, opts = {}) {
  const { tenant = T, quiet = false } = opts;
  const r = await fetch(`${API}${p}`, {
    method,
    headers: { "Content-Type": "application/json", ...(tenant ? { "X-Tenant": tenant } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 429) {
    // Each company has a request limit per minute; wait for the next minute and carry on.
    if (!waitedNote) { console.log("  (pausing for the company's per-minute request limit; this is normal)"); waitedNote = true; }
    await new Promise((res) => setTimeout(res, 61_000 - (Date.now() % 60_000) + 500));
    return call(method, p, token, body, opts);
  }
  if (!r.ok) {
    const err = new Error(`${method} ${p}: ${r.status} ${JSON.stringify(j)}`);
    err.status = r.status; err.body = j;
    if (quiet) return Promise.reject(err);
    throw err;
  }
  return j;
}
const list = (x) => (Array.isArray(x) ? x : x?.items ?? x?.rows ?? x?.data ?? x?.invoices ?? []);
const soft = (p) => p.catch((e) => { if (process.env.DEMO_DEBUG) console.warn("  skipped:", e.message); return null; });

// Wait up to three minutes for the API (in Docker it starts at the same time as this script).
for (let i = 0; ; i++) {
  try { if ((await fetch(`${API.replace(/\/api\/v1$/, "")}/health`)).ok) break; } catch {}
  if (i === 0) console.log("Waiting for the API to start…");
  if (i >= 90) {
    console.error("The API isn't running. Start it first (pnpm dev, or the Docker setup), wait for \"eszy API on :4000\", then run the demo again.");
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 2000));
}
if (!DB_URL) { console.error("Set MIGRATION_DATABASE_URL (it's in .env.development.example)."); process.exit(1); }

// Dates in the company's time zone (India).
const todayIso = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const day = (n) => addDays(todayIso, n);
const dow = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const isWeekday = (iso) => dow(iso) >= 1 && dow(iso) <= 5;
const weekday = (n, dir = -1) => { let d = day(n); while (!isWeekday(d)) d = addDays(d, dir); return d; };
const at = (iso, hhmm = "10:00") => `${iso}T${hhmm}:00+05:30`;

// Small seeded random generator so every run produces the same story.
let seedN = 20261110;
const rnd = () => { seedN |= 0; seedN = (seedN + 0x6d2b79f5) | 0; let t = Math.imul(seedN ^ (seedN >>> 15), 1 | seedN); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

const db = new pg.Client({ connectionString: DB_URL });
await db.connect();
const tenantId = (await db.query("SELECT id FROM tenants WHERE slug = $1", [T])).rows[0]?.id;
if (!tenantId) { console.error("There's no demo company. Run the seed with SEED_DEMO=1 first."); process.exit(1); }
await db.query("SELECT set_config('app.tenant_id', $1, false)", [tenantId]);
const sql = (q, p = []) => db.query(q, p);

const login = async (email) => (await call("POST", "/auth/login", null, { email, password: "password123" })).accessToken;
const admin = await login("admin@demo.test");

if ((await sql("SELECT count(*)::int AS n FROM clients WHERE tenant_id = $1", [tenantId])).rows[0].n > 1) {
  console.log("The demo company already has sample data. To start over, reset the database and run setup again:");
  console.log("  docker compose -f docker-compose.dev.yml down -v && docker compose -f docker-compose.dev.yml up");
  process.exit(0);
}
console.log(`Building demo data for ${todayIso}. This takes about five minutes.`);

// ---------------------------------------------------------------- company settings
await call("PUT", "/settings", admin, {
  branding: { displayName: "Demo Studio", emailSenderName: "Demo Studio Accounts" },
  tax: { country: "IN", state: "Karnataka", taxId: "29ABCDE1234F1Z5", legalName: "Demo Studio Pvt Ltd", address: "12 MG Road, Bengaluru 560001", rates: [{ name: "GST", rateBp: 1800 }], exportRateBp: 0 },
  locale: { currency: "INR", timezone: "Asia/Kolkata" },
  invoices: { footer: "Bank: HDFC Bank, A/c 0000 1234 5678, IFSC HDFC0000001. Thank you for your business.", dueSoonDays: 3, template: "modern" },
  // Opened up while history is filled in, put back to 7 days at the end.
  policies: { sheetEditDays: 120, standupEnabled: true, sandwichRule: false },
});

// ---------------------------------------------------------------- lists, departments
const roles = list(await call("GET", "/roles", admin));
const roleId = (key) => roles.find((r) => r.key === key)?.id;
const sources = list(await call("GET", "/lists/project-sources", admin));
const sourceId = (n) => sources.find((s) => s.name === n)?.id;
const acctUpwork = await call("POST", "/lists/project-accounts", admin, { name: "Demo Studio (Upwork agency)", sourceId: sourceId("Upwork"), profileUrl: "https://www.upwork.com/agencies/demostudio" });
const acctDirect = await call("POST", "/lists/project-accounts", admin, { name: "Direct contracts", sourceId: sourceId("Direct") });
const comm = list(await call("GET", "/lists/communication-types", admin));
const commId = (n) => comm.find((c) => c.name === n)?.id;
const acts = list(await call("GET", "/lists/activity-types", admin));
const act = (n) => acts.find((a) => a.name === n)?.id;
if (!act("Documentation")) await soft(call("POST", "/lists/activity-types", admin, { name: "Documentation", category: "inhouse" }));
acts.push(await call("POST", "/lists/activity-types", admin, { name: "Waiting for client", category: "no_work" }));
acts.push(await call("POST", "/lists/activity-types", admin, { name: "Training", category: "inhouse" }));

const dept = {};
const existingDepts = list(await call("GET", "/departments", admin));
for (const n of ["Engineering", "Design", "Sales", "Operations"]) dept[n] = existingDepts.find((d) => d.name === n)?.id ?? (await call("POST", "/departments", admin, { name: n })).id;
log("settings, lists and departments");

// ---------------------------------------------------------------- people and teams
let users = list(await call("GET", "/users", admin));
const uid = (email) => users.find((u) => u.email === email)?.id;
const newPeople = [
  ["Karan Mehta", "karan@demo.test", ["employee"], "Engineering", 55000, -400, "DS-007", "Full-stack Developer"],
  ["Priya Nair", "priya@demo.test", ["employee"], "Design", 60000, -320, "DS-008", "UI/UX Designer"],
  ["Vikram Rao", "vikram@demo.test", ["team_lead", "employee"], "Engineering", 85000, -900, "DS-009", "Mobile Team Lead"],
  ["Neha Gupta", "neha@demo.test", ["employee"], "Engineering", 50000, -250, "DS-010", "React Native Developer"],
  ["Arjun Das", "arjun@demo.test", ["employee"], "Engineering", 40000, -100, "DS-011", "Junior Developer"],
  ["Dev Kapoor", "pm@demo.test", ["project_manager"], "Operations", 90000, -600, "DS-012", "Project Manager"],
  ["Hema Iyer", "hr@demo.test", ["hr"], "Operations", 45000, -500, "DS-013", "HR Executive"],
  ["Meera Pillai", "meera@demo.test", ["sales"], "Sales", 35000, -150, "DS-014", "Business Development Executive"],
];
for (const [name, email, rk, dp, cost, joined, code, designation] of newPeople) {
  await call("POST", "/users", admin, { name, email, roleIds: rk.map(roleId), departmentId: dept[dp], costPerHourMinor: cost, joinedOn: day(joined), phone: `+91 98${String(Math.floor(rnd() * 1e8)).padStart(8, "0")}`,
    employeeCode: code, designation, employmentStatus: joined > -180 ? "provisional" : "appointed", password: "password123" });
}
// Invited people would normally set a password from their email; for the demo they all use password123.
await sql(`UPDATE users SET status = 'active', password_hash = (SELECT password_hash FROM users WHERE email = 'admin@demo.test' AND tenant_id = $1)
           WHERE tenant_id = $1 AND status = 'invited'`, [tenantId]);
users = list(await call("GET", "/users", admin));

const month = String(Number(todayIso.slice(5, 7))).padStart(2, "0");
const codes = { "admin@demo.test": ["DS-001", "Managing Director"], "billing@demo.test": ["DS-002", "Accounts Manager"], "tl@demo.test": ["DS-003", "Web Team Lead"],
  "employee@demo.test": ["DS-004", "Frontend Developer"], "sales@demo.test": ["DS-005", "Sales Executive"], "salestl@demo.test": ["DS-006", "Sales Team Lead"] };
const existingUpdates = {
  "admin@demo.test": ["Operations", 150000, -1500, `1985-03-14`],
  "billing@demo.test": ["Operations", 70000, -800, `1990-${month}-${String(Math.min(28, Number(todayIso.slice(8)) + 4)).padStart(2, "0")}`],
  "tl@demo.test": ["Engineering", 80000, -1100, "1991-07-02"],
  "employee@demo.test": ["Engineering", 45000, -300, `1996-${month}-20`],
  "sales@demo.test": ["Sales", 40000, -700, "1993-01-09"],
  "salestl@demo.test": ["Sales", 65000, -1000, "1989-11-30"],
};
for (const u of users) {
  const e = existingUpdates[u.email];
  if (!e) continue;
  await sql("UPDATE users SET department_id = $2, cost_per_hour_minor = $3, joined_on = $4, date_of_birth = $5, address = 'Bengaluru, Karnataka', employee_code = $6, designation = $7, employment_status = 'appointed' WHERE id = $1",
    [u.id, dept[e[0]], e[1], day(e[2]), e[3], codes[u.email][0], codes[u.email][1]]);
}
// Arjun is on probation, Neha is serving notice, and a past employee is disabled.
await sql("UPDATE users SET probation_ends_on = $2 WHERE id = $1", [uid("arjun@demo.test"), day(80)]);
await sql("UPDATE users SET notice_starts_on = $2, last_working_day = $3, employment_status = 'notice' WHERE id = $1", [uid("neha@demo.test"), day(-10), day(20)]);
await sql("UPDATE users SET emergency_contact_name = 'Ravi (brother)', emergency_contact_phone = '+91 98000 00000', address = '4 Park Street, Bengaluru' WHERE id = $1", [uid("employee@demo.test")]);
await sql("UPDATE users SET date_of_birth = $2 WHERE id = $1", [uid("priya@demo.test"), `1995-${month}-${String(Math.max(1, Number(todayIso.slice(8)) - 3)).padStart(2, "0")}`]);
await call("POST", "/users", admin, { name: "Rohan Shah", email: "rohan@demo.test", roleIds: [roleId("employee")], departmentId: dept.Engineering, joinedOn: day(-700), lastWorkingDay: day(-120), employeeCode: "DS-000", designation: "Developer" });
await sql("UPDATE users SET employment_status = 'inactive', inactive_from = $2 WHERE email = 'rohan@demo.test' AND tenant_id = $1", [tenantId, day(-119)]);
await sql("UPDATE users SET status = 'disabled', password_hash = NULL WHERE email = 'rohan@demo.test' AND tenant_id = $1", [tenantId]).catch(() => sql("UPDATE users SET status = 'disabled' WHERE email = 'rohan@demo.test' AND tenant_id = $1", [tenantId]));
users = list(await call("GET", "/users", admin));

const P = Object.fromEntries(["admin", "billing", "tl", "employee", "sales", "salestl", "karan", "priya", "vikram", "neha", "arjun", "pm", "hr", "meera"].map((k) => [k, uid(`${k}@demo.test`)]));
const teams = list(await call("GET", "/teams", admin));
const webTeam = teams.find((t) => t.name === "Web team");
await call("PUT", `/teams/${webTeam.id}`, admin, { name: "Web team", leadUserId: P.tl, managerUserId: P.pm, departmentId: dept.Engineering, memberIds: [P.employee, P.karan, P.priya] });
const mobileTeam = await call("POST", "/teams", admin, { name: "Mobile team", leadUserId: P.vikram, managerUserId: P.pm, departmentId: dept.Engineering, memberIds: [P.neha, P.arjun] });
await call("POST", "/teams", admin, { name: "Sales team", leadUserId: P.salestl, managerUserId: P.admin, departmentId: dept.Sales, memberIds: [P.sales, P.meera] });
// TLs and the PM report to the admin; Priya (design) reports to the PM directly.
for (const k of ["tl", "vikram", "pm", "salestl", "hr", "billing"]) await call("PUT", `/users/${P[k]}`, admin, { reportingManagerId: P.admin });
await call("POST", "/roles", admin, { name: "QA Lead", permissions: ["dashboard.view", "time.own", "leave.request", "projects.view_all"].filter((p) => roles.some((r) => r.permissions?.includes(p)) || p === "dashboard.view") });

const tokens = {};
for (const k of ["billing", "tl", "employee", "sales", "salestl", "karan", "priya", "vikram", "neha", "arjun", "pm", "meera"]) tokens[k] = await login(`${k}@demo.test`);
const bm = tokens.billing;
log(`${users.length} people in 3 teams`);

// ---------------------------------------------------------------- holidays, leave types, past leave and WFH
const y = Number(todayIso.slice(0, 4));
const holidayDates = [];
for (const [d, n] of [[`${y}-01-26`, "Republic Day"], [`${y}-08-15`, "Independence Day"], [`${y}-10-02`, "Gandhi Jayanti"], [`${y}-12-25`, "Christmas"], [`${y + 1}-01-01`, "New Year's Day"], [`${y + 1}-01-26`, "Republic Day"]]) {
  await soft(call("POST", "/holidays", admin, { date: d, name: n }));
  holidayDates.push(d);
}
const offsite = weekday(-38);
await call("POST", "/holidays", admin, { date: offsite, name: "Company offsite", kind: "non_working", description: "Team trip to Coorg" });
const halfDiwali = weekday(-5);
await call("POST", "/holidays", admin, { date: halfDiwali, name: "Diwali (half day)", halfDay: true });
holidayDates.push(offsite);

await call("POST", "/leave/types", admin, { name: "Paternity leave", yearlyDays: 5, paid: true, allowedInProbation: false, maxPerRequest: 5 });
await call("POST", "/leave/types", admin, { name: "Work from abroad", yearlyDays: 0, paid: true, active: false });
const leaveTypes = list(await call("GET", "/leave/types", admin));
const lt = (n) => leaveTypes.find((t) => t.name === n)?.id;
await call("POST", "/leave/balances/adjust", admin, { userId: P.karan, leaveTypeId: lt("Casual leave"), year: y, creditedDays: 14 });

const onLeave = new Map(); // `${person}|${date}` -> "full" | "half"
const wfhDays = new Map();
async function leave(who, type, from, to, reason, decide, approverTok, halfDay = false) {
  const r = await soft(call("POST", "/leave/requests", tokens[who], { leaveTypeId: lt(type), startDate: from, endDate: to, reason, halfDay }));
  if (!r) return;
  if (decide) await soft(call("POST", `/leave/requests/${r.id}/${decide}`, approverTok));
  if (decide === "approve") for (let d = from; d <= to; d = addDays(d, 1)) onLeave.set(`${who}|${d}`, halfDay ? "half" : "full");
}
await leave("employee", "Casual leave", weekday(-60), weekday(-60), "Cousin's wedding", "approve", tokens.tl);
await leave("karan", "Sick leave", weekday(-33), addDays(weekday(-33), 0), "Fever", "approve", tokens.tl);
await leave("priya", "Casual leave", weekday(-22), weekday(-22), "Family function", "approve", tokens.tl, true);
{ const r = await soft(call("POST", "/leave/requests", tokens.karan, { leaveTypeId: lt("Casual leave"), startDate: weekday(-13), endDate: weekday(-13), part: "short", shortMinutes: 120, reason: "Bank visit" }));
  if (r) { await soft(call("POST", `/leave/requests/${r.id}/approve`, tokens.tl)); onLeave.set(`karan|${weekday(-13)}`, "short"); } }
{ const r = await soft(call("POST", "/leave/requests", tokens.neha, { leaveTypeId: lt("Casual leave"), startDate: weekday(-27), endDate: weekday(-27), part: "second_half", reason: "Doctor's appointment" }));
  if (r) { await soft(call("POST", `/leave/requests/${r.id}/approve`, tokens.vikram)); onLeave.set(`neha|${weekday(-27)}`, "half"); } }
await leave("neha", "Casual leave", weekday(-47), addDays(weekday(-47), 0), "Moving house", "approve", tokens.vikram);
await leave("arjun", "Sick leave", weekday(-15), weekday(-15), "Dentist", "approve", tokens.vikram);
await leave("vikram", "Casual leave", weekday(-71), weekday(-71), "Personal work", "approve", admin);
await leave("karan", "Casual leave", weekday(-8), weekday(-8), "Bank work", "reject", tokens.tl);
await leave("employee", "Casual leave", weekday(9, 1), weekday(10, 1), "Trip to Mysuru", null);
await leave("vikram", "Casual leave", weekday(16, 1), weekday(18, 1), "Vacation", "approve", admin);
await leave("arjun", "Paternity leave", weekday(30, 1), weekday(31, 1), "Expected arrival", null); // refused in probation: shows the rule
await leave("priya", "Sick leave", weekday(4, 1), weekday(4, 1), "Doctor's appointment", null, null, true);

async function wfh(who, date, kind, reason, decide, approverTok) {
  const r = await soft(call("POST", "/wfh", tokens[who], { date, kind, reason }));
  if (!r) return;
  if (decide) await soft(call("POST", `/wfh/${r.id}/${decide}`, approverTok));
  if (decide === "approve") wfhDays.set(`${who}|${date}`, kind);
}
for (const [who, n, tok] of [["employee", -55, "tl"], ["karan", -41, "tl"], ["neha", -26, "vikram"], ["employee", -18, "tl"], ["arjun", -9, "vikram"], ["priya", -6, "tl"]]) {
  await wfh(who, weekday(n), n === -26 ? "half" : "full", pick(["Plumber visit", "Internet installation at home", "Waiting for a delivery", "Not feeling well enough to travel"]), "approve", tokens[tok]);
}
await wfh("karan", weekday(3, 1), "full", "Landlord inspection", null);
await soft(call("POST", "/wfh", tokens.priya, { date: weekday(2, 1), kind: "hours", minutes: 180, reason: "Morning at home for a delivery" }));
await wfh("neha", weekday(5, 1), "half", "Parent-teacher meeting", null);
await wfh("arjun", weekday(-4), "full", "Bike at the service centre", "reject", tokens.vikram);
log("holidays, leave and WFH");

// ---------------------------------------------------------------- leads and sales
const leads = [];
async function lead(by, data, calls = [], createdDaysAgo = 30) {
  const l = await call("POST", "/leads", tokens[by], data);
  leads.push(l);
  await sql("UPDATE leads SET created_at = $2, updated_at = $2 WHERE id = $1", [l.id, at(day(-createdDaysAgo), "11:00")]);
  let n = createdDaysAgo;
  for (const [who, outcome, notes, follow] of calls) {
    n = Math.max(0, n - (2 + Math.floor(rnd() * 4)));
    await call("POST", `/leads/${l.id}/calls`, tokens[who], { outcome, notes, nextFollowUpAt: follow != null ? at(day(follow), "15:00") : null });
    await sql("UPDATE lead_calls SET called_at = $2 WHERE id = (SELECT id FROM lead_calls WHERE lead_id = $1 ORDER BY called_at DESC LIMIT 1)", [l.id, at(day(-n), `${10 + Math.floor(rnd() * 7)}:${pick(["05", "20", "35", "50"])}`)]);
    if (outcome === "converted") await sql("UPDATE leads SET converted_at = $2 WHERE id = $1", [l.id, at(day(-n), "17:00")]);
  }
  return l;
}
const leadFern = await lead("sales", { title: "Patient app for Fernwood Health", contactName: "Sara Lee", email: "sara@fernwood.test", company: "Fernwood Health", country: "GB", source: "Referral", estimatedValueMinor: 9_60_000_00, callerId: P.meera, notes: "Referred by Leo at Parkside." },
  [["meera", "no_answer", "Voicemail"], ["meera", "interested", "Wants iOS and Android; asked for a quote", 0], ["meera", "follow_up", "Shared the proposal, call back next week", 0], ["meera", "converted", "Signed the milestone plan"]], 75);
const leadAli = await lead("salestl", { title: "Shopify migration for Ali Traders", contactName: "Omar Ali", email: "omar@alitraders.test", company: "Ali Traders", country: "AE", source: "Upwork", estimatedValueMinor: 1_76_000_00, callerId: P.sales },
  [["sales", "interested", "Moving from WooCommerce, about 2,000 products"], ["sales", "converted", "Accepted the hourly offer on Upwork"]], 40);
const leadNimbus = await lead("sales", { title: "Fleet tracking app", contactName: "Kabir Sethi", email: "kabir@nimbus.test", company: "Nimbus Logistics", country: "IN", source: "Direct", estimatedValueMinor: 13_50_000_00, callerId: P.employee },
  [["employee", "interested", "Needs driver and dispatcher apps"], ["employee", "converted", "Walked them through our past work; they signed"]], 100);
await lead("meera", { title: "Booking site for Lotus Spa", contactName: "Anita Rao", company: "Lotus Spa", country: "IN", source: "Instagram", estimatedValueMinor: 80_000_00, callerId: P.meera },
  [["meera", "no_answer", ""], ["meera", "follow_up", "Asked us to call after their Diwali rush", 2]], 20);
await lead("sales", { title: "ERP integration", contactName: "Tom Becker", company: "Becker GmbH", country: "DE", source: "LinkedIn", estimatedValueMinor: 25_00_000_00, callerId: P.salestl },
  [["salestl", "interested", "Need SAP connector estimate"], ["salestl", "follow_up", "Waiting on their IT team", -2]], 25);
await lead("meera", { title: "Restaurant ordering app", contactName: "Farah Khan", company: "Spice Route", country: "IN", source: "Referral", callerId: P.karan },
  [["karan", "not_interested", "Went with a cheaper freelancer"]], 35);
await lead("sales", { title: "Website refresh", contactName: "Jun Park", company: "Hanbit Tea", country: "KR", source: "Upwork", estimatedValueMinor: 1_20_000_00, callerId: P.meera }, [["meera", "interested", "Wants a quote by Friday", 1]], 6);
await lead("salestl", { title: "Data dashboard", contactName: "Lena Ortiz", company: "Ortiz Analytics", country: "US", source: "Direct", estimatedValueMinor: 4_00_000_00 }, [], 3);
await lead("meera", { title: "Mobile game prototype", contactName: "Sam Wright", company: "Wrightplay", country: "AU", source: "Fiverr", callerId: P.sales }, [], 1);
await lead("sales", { title: "Annual maintenance contract", contactName: "Leo Park", company: "Parkside Co", country: "US", source: "Referral", callerId: P.sales, estimatedValueMinor: 3_60_000_00 },
  [["sales", "follow_up", "Renewal talk after their board meeting", -1]], 14);
const kora = await lead("meera", { title: "Menu and ordering redesign", contactName: "Yusuf Haddad", company: "Kora Foods", country: "AE", source: "Direct", estimatedValueMinor: 1_20_000_00, callerId: P.meera },
  [["meera", "interested", "Loved the Ruiz Legal case study"], ["meera", "converted", "50% advance agreed"]], 50);
log(`${leads.length} leads with calls`);

// ---------------------------------------------------------------- clients
// The seed made one project with tiny numbers; it's replaced by the projects below.
const seededProject = (await sql("SELECT id FROM projects WHERE tenant_id = $1", [tenantId])).rows.map((r) => r.id);
for (const id of seededProject) {
  for (const t of ["time_allocations", "billing_lines", "project_members", "tasks"]) await sql(`DELETE FROM ${t} WHERE ${t === "time_allocations" ? "billing_line_id IN (SELECT id FROM billing_lines WHERE project_id = $1)" : "project_id = $1"}`, [id]).catch(() => {});
  await sql("DELETE FROM projects WHERE id = $1", [id]);
}
const brightcart = (await sql("SELECT id FROM clients WHERE tenant_id = $1 LIMIT 1", [tenantId])).rows[0].id;
const cm = (...n) => n.map(commId).filter(Boolean);
await call("PUT", `/clients/${brightcart}`, admin, { name: "Mia Chen", company: "BrightCart", email: "mia@brightcart.test", phone: "+91 22 4000 1000", country: "IN", state: "Maharashtra", taxId: "27AAACB1234C1Z2", address: "Lower Parel, Mumbai",
  clientType: "upwork", hiringId: "01f3a9c2d7e4b51a", contactName: "Mia Chen", website: "https://brightcart.test", communicationTypeIds: cm("Slack", "Upwork messages"), sourceId: sourceId("Upwork"), accountId: acctUpwork.id, preferredBilling: "hourly", notes: "Long-term client. Weekly report every Friday." });
const client = async (b) => (await call("POST", "/clients", admin, b)).id;
const parkside = await client({ name: "Leo Park", company: "Parkside Co", email: "leo@parkside.test", phone: "+1 503 555 0142", country: "US", address: "Portland, Oregon", clientType: "direct", contactName: "Leo Park", website: "https://parkside.test",
  communicationTypeIds: cm("Email", "Zoom"), sourceId: sourceId("Direct"), accountId: acctDirect.id, preferredBilling: "hourly" });
const ruiz = await client({ name: "Ana Ruiz", company: "Ruiz Legal", email: "ana@ruiz.test", country: "IN", state: "Karnataka", taxId: "29AAJCR5678D1Z9", address: "Indiranagar, Bengaluru", clientType: "direct",
  contactName: "Ana Ruiz", communicationTypeIds: cm("WhatsApp", "Google Meet"), sourceId: sourceId("Referral"), preferredBilling: "fixed" });
const onboard = async (l, extra) => (await call("POST", `/leads/${l.id}/client`, admin, extra)).id;
const fernwood = await onboard(leadFern, { country: "GB", address: "Leeds, United Kingdom" });
const ali = await onboard(leadAli, { country: "AE", address: "Deira, Dubai" });
const nimbus = await onboard(leadNimbus, { country: "IN", state: "Karnataka", taxId: "29AAECN4321F1Z3", address: "Whitefield, Bengaluru" });
const koraC = await onboard(kora, { country: "AE", address: "Al Quoz, Dubai" });
await call("PUT", `/clients/${fernwood}`, admin, { clientType: "direct", contactName: "Sara Lee", communicationTypeIds: cm("Email", "Zoom"), sourceId: sourceId("Referral"), preferredBilling: "fixed" });
await call("PUT", `/clients/${ali}`, admin, { clientType: "upwork", hiringId: "0b77e1f02c9d4a33", contactName: "Omar Ali", communicationTypeIds: cm("Upwork messages"), sourceId: sourceId("Upwork"), accountId: acctUpwork.id, preferredBilling: "hourly" });
await call("PUT", `/clients/${nimbus}`, admin, { clientType: "direct", contactName: "Kabir Sethi", communicationTypeIds: cm("Slack", "Google Meet", "Phone"), sourceId: sourceId("Direct"), accountId: acctDirect.id, preferredBilling: "hourly" });
await call("PUT", `/clients/${koraC}`, admin, { clientType: "direct", contactName: "Yusuf Haddad", communicationTypeIds: cm("WhatsApp"), sourceId: sourceId("Direct") });
const internalClient = await client({ name: "Demo Studio", company: "Demo Studio (internal)", country: "IN", state: "Karnataka" });
await client({ name: "Grace Liu", company: "Harbor Books", email: "grace@harbor.test", country: "SG", clientType: "other", hiringId: "FL-88231", contactName: "Grace Liu", sourceId: sourceId("Freelancer"), status: "inactive", notes: "Paused after the 2025 project." });
log("clients");

// ---------------------------------------------------------------- projects
const proj = {};
const mk = async (key, by, body) => { const r = await call("POST", "/projects", by, body); proj[key] = r.project ?? r; return proj[key]; };
await mk("bright", bm, { tlIds: [P.tl], estimatorUserId: P.tl, callerUserId: P.sales, tags: ["shopify", "ecommerce"],
  clientId: brightcart, name: "BrightCart store rebuild", code: "BC-01", type: "hourly", billingType: "prepaid", invoicing: "one_time", hourlyRateMinor: 2_000_00,
  billingCapMinutes: 50 * H, billingPeriod: "week", startDate: day(-91), billingDate: day(-91), dueDays: 7, memberIds: [P.employee, P.karan, P.tl], pmUserId: P.pm, salesUserId: P.sales,
  sourceId: sourceId("Upwork"), accountId: acctUpwork.id, communicationTypeIds: [commId("Slack"), commId("Upwork messages")].filter(Boolean),
  description: "Rebuild of BrightCart's Shopify storefront: new theme, faster checkout, product filters.",
  billingLines: [
    { label: "First 220 hours", minutes: 220 * H, amountMinor: 4_40_000_00, dueDate: day(-91) },
    { label: "Next 220 hours", minutes: 220 * H, amountMinor: 4_40_000_00, dueDate: day(-50) },
    { label: "Next 200 hours", minutes: 200 * H, amountMinor: 4_00_000_00, dueDate: day(-14) },
  ],
});
await mk("park", bm, { tlIds: [P.tl], estimatorUserId: P.pm, callerUserId: P.sales, tags: ["support", "node"],
  clientId: parkside, name: "Parkside support retainer", code: "PK-SUP", type: "hourly", billingType: "postpaid", invoicing: "recurring", hourlyRateMinor: 3_000_00,
  billingCapMinutes: 40 * H, billingPeriod: "week", startDate: day(-90), dueDays: 14, memberIds: [P.tl, P.arjun, P.pm], pmUserId: P.pm, salesUserId: P.sales,
  sourceId: sourceId("Direct"), accountId: acctDirect.id, communicationTypeIds: [commId("Email"), commId("Zoom")].filter(Boolean),
  description: "Ongoing support and small features for Parkside's customer portal, billed weekly for hours worked.",
  billingLines: [{ label: "Support budget", minutes: 600 * H, amountMinor: 18_00_000_00 }],
});
await mk("ruiz", bm, { tlIds: [P.tl], estimatorUserId: P.priya, callerUserId: P.meera, tags: ["website", "wordpress"],
  clientId: ruiz, name: "Ruiz Legal website", code: "RL-WEB", type: "fixed", fixedOption: "installments", priceMinor: 10_00_000_00, estimatedMinutes: 540 * H,
  installmentCount: 3, installmentInterval: "month", startDate: day(-80), dueDays: 10, memberIds: [P.employee, P.priya, P.tl], pmUserId: P.pm, deliveryDate: day(12),
  sourceId: sourceId("Referral"), description: "New website with case-study pages, a blog and a client portal login.",
});
await mk("nimbus", bm, { tlIds: [P.vikram], estimatorUserId: P.vikram, callerUserId: P.employee, tags: ["react-native", "mobile"],
  clientId: nimbus, name: "Nimbus fleet app", code: "NB-APP", type: "hourly", billingType: "prepaid", invoicing: "recurring", hourlyRateMinor: 2_500_00,
  billingCapMinutes: 320 * H, billingPeriod: "month", billingDate: day(-85), startDate: day(-85), dueDays: 7, memberIds: [P.vikram, P.neha], pmUserId: P.pm, salesUserId: P.sales, leadId: leadNimbus.id,
  sourceId: sourceId("Direct"), accountId: acctDirect.id, communicationTypeIds: [commId("Slack"), commId("Google Meet")].filter(Boolean),
  description: "Driver and dispatcher apps (React Native) with live tracking. 320 hours a month, invoiced at the start of each month.",
});
await mk("fern", bm, { tlIds: [P.vikram], estimatorUserId: P.vikram, callerUserId: P.meera, tags: ["mobile", "healthcare"],
  clientId: fernwood, name: "Fernwood patient app", code: "FW-APP", type: "fixed", fixedOption: "milestones", priceMinor: 9_60_000_00, startDate: day(-60), dueDays: 15,
  memberIds: [P.vikram, P.neha, P.arjun], pmUserId: P.pm, salesUserId: P.meera, leadId: leadFern.id, deliveryDate: day(40), sourceId: sourceId("Referral"),
  description: "Appointment booking and reminders app for Fernwood's clinics.",
  billingLines: [
    { label: "Design and prototype", minutes: 120 * H, amountMinor: 1_92_000_00, dueDate: day(-55) },
    { label: "Core app", minutes: 260 * H, amountMinor: 3_84_000_00, dueDate: day(-25) },
    { label: "Integrations", minutes: 180 * H, amountMinor: 2_40_000_00, dueDate: day(10) },
    { label: "Launch and handover", minutes: 100 * H, amountMinor: 1_44_000_00, dueDate: day(40) },
  ],
});
await mk("kora", bm, { tlIds: [P.tl], estimatorUserId: P.priya, callerUserId: P.meera, tags: ["design"],
  clientId: koraC, name: "Kora menu redesign", code: "KF-UX", type: "fixed", fixedOption: "advance_balance", priceMinor: 1_20_000_00, estimatedMinutes: 60 * H, advancePercent: 50,
  deliveryDate: day(6), startDate: day(-40), dueDays: 5, dueSoonDays: 5, memberIds: [P.priya, P.karan], salesUserId: P.meera, leadId: kora.id, sourceId: sourceId("Direct"),
  description: "Redesign of the online menu and ordering flow.",
});
await mk("ali", bm, { tlIds: [P.tl], estimatorUserId: P.karan, callerUserId: P.sales, tags: ["shopify", "migration"],
  clientId: ali, name: "Ali Traders Shopify migration", code: "AT-MIG", type: "hourly", billingType: "postpaid", invoicing: "one_time", hourlyRateMinor: 2_200_00,
  startDate: day(-28), dueDays: 2, memberIds: [P.karan], salesUserId: P.sales, leadId: leadAli.id, sourceId: sourceId("Upwork"), accountId: acctUpwork.id,
  billingLines: [{ label: "Estimated hours", minutes: 80 * H, amountMinor: 1_76_000_00 }], description: "Move 2,000 products and customers from WooCommerce to Shopify.",
});
await mk("landing", bm, {
  clientId: brightcart, name: "BrightCart festive landing page", code: "BC-FEST", type: "fixed", fixedOption: "one_time", priceMinor: 40_000_00, estimatedMinutes: 24 * H,
  startDate: day(-95), dueDays: 7, memberIds: [P.priya], description: "One-off campaign page for the festive sale.",
});
await mk("seo", bm, {
  clientId: ruiz, name: "Ruiz Legal SEO audit", code: "RL-SEO", type: "hourly", billingType: "postpaid", invoicing: "one_time", hourlyRateMinor: 1_800_00, startDate: day(-20), memberIds: [P.employee],
  description: "Paused until their new site is live.",
});
await mk("internal", admin, {
  clientId: internalClient, name: "Internal: training, hiring and meetings", code: "INT", type: "hourly", billingType: "postpaid", invoicing: "one_time", hourlyRateMinor: 0,
  startDate: day(-120), memberIds: [P.employee, P.karan, P.priya, P.tl, P.vikram, P.neha, P.arjun, P.pm], description: "Non-billable time. Never invoiced.", isInternal: true, tags: ["internal"],
});
await call("POST", `/projects/${proj.seo.id}/status`, admin, { status: "paused" });
await call("POST", `/projects/${proj.bright.id}/extra-hours`, bm, { label: "Fix layout bugs (no charge)", minutes: 10 * H, amountMinor: 0 });
const tr1 = await call("POST", `/projects/${proj.bright.id}/trackers`, bm, { label: "Upwork contract: Store rebuild", externalId: "UPW-38821904" });
const tr2 = await call("POST", `/projects/${proj.ali.id}/trackers`, bm, { label: "Upwork contract: Migration", externalId: "UPW-39140277" });

const tasks = {};
const taskList = {
  bright: [["Product filters", P.karan, "done", "medium"], ["Checkout validation", P.employee, "in_progress", "high", 3], ["Speed audit", P.tl, "done"], ["Order emails", P.employee, "todo", "medium", 6], ["Reviews widget", P.karan, "review", "low"], ["Wishlist", null, "todo", "low", 20]],
  park: [["Ticket: CSV export broken", P.arjun, "done", "high"], ["Monthly usage report", P.tl, "in_progress", "medium", 2], ["Upgrade to Node 22", P.arjun, "todo", "medium", 9]],
  ruiz: [["Home page design", P.priya, "done"], ["Case study template", P.priya, "done"], ["Blog", P.employee, "review", "medium", -1], ["Client login", P.employee, "in_progress", "high", 5]],
  nimbus: [["Driver app: live location", P.neha, "done", "high"], ["Dispatcher map", P.vikram, "in_progress", "high", 4], ["Push notifications", P.neha, "in_progress", "medium", 7], ["Offline mode", null, "todo", "low", 25]],
  fern: [["Booking flow", P.arjun, "done", "high"], ["Reminders", P.neha, "in_progress", "medium", 6], ["NHS login research", P.vikram, "review", "medium"]],
  kora: [["Menu layout", P.priya, "done"], ["Checkout screens", P.karan, "review", "high", -2]],
  ali: [["Product import script", P.karan, "done"], ["Customer import", P.karan, "done"], ["Redirects", P.karan, "done"]],
};
for (const [k, ts] of Object.entries(taskList)) {
  tasks[k] = [];
  for (const [title, who, status, priority, dueIn] of ts) {
    const t = await call("POST", `/projects/${proj[k].id}/tasks`, admin, { title, assigneeId: who, status: status ?? "todo", priority: priority ?? "medium",
      dueDate: dueIn != null ? day(dueIn) : null, estimatedMinutes: priority === "high" ? 16 * H : 8 * H, description: `${title} for ${proj[k].name}.` });
    tasks[k].push(t);
  }
}
log(`${Object.keys(proj).length} projects with tasks and trackers`);

// ---------------------------------------------------------------- three months of daily sheets
// Each person splits a normal day across their projects; a project that hasn't started, has ended or is at a cap
// sends the hours to the internal project instead, the way a TL would redirect someone.
const plan = {
  employee: [["bright", 5, "Development"], ["ruiz", 3, "Development"], ["internal", 1, "Meeting"], ["bright", 0.4, "Waiting for client"]],
  karan: [["bright", 4, "Development"], ["ali", 4, "Development"], ["kora", 2, "Development"], ["internal", 1, "Research"]],
  priya: [["landing", 3, "Design"], ["ruiz", 5, "Design"], ["kora", 4, "Design"], ["internal", 1, "Meeting"]],
  tl: [["bright", 2, "Code review"], ["park", 5, "Support"], ["ruiz", 1, "Code review"], ["internal", 1, "Meeting"]],
  vikram: [["nimbus", 4, "Development"], ["fern", 3, "Code review"], ["internal", 2, "Meeting"]],
  neha: [["nimbus", 6, "Development"], ["fern", 4, "Development"], ["internal", 1, "Research"]],
  arjun: [["fern", 5, "Development"], ["park", 5, "Bug fix"], ["internal", 1, "Training"], ["park", 0.6, "Waiting for client"]],
  pm: [["internal", 3, "Meeting"], ["bright", 1, "Meeting"], ["nimbus", 2, "Meeting"], ["fern", 1, "Meeting"], ["park", 1, "Meeting"]],
};
const descs = {
  bright: ["Product filter sidebar", "Checkout validation", "Cart drawer", "Order confirmation emails", "Theme performance fixes", "Review of pull requests"],
  park: ["Support tickets", "CSV export fix", "Customer portal bug fixes", "Monthly usage report", "Node upgrade"],
  ruiz: ["Home page", "Case study pages", "Blog templates", "Client login", "Responsive fixes"],
  nimbus: ["Driver app location tracking", "Dispatcher map", "Push notifications", "API integration", "Sprint planning"],
  fern: ["Booking flow", "Reminder scheduling", "Clinic list screens", "Design review", "QA fixes"],
  kora: ["Menu layout", "Checkout screens", "Design handoff"],
  ali: ["Product import script", "Customer import", "URL redirects", "Data checks"],
  landing: ["Festive banner designs", "Landing page build"],
  internal: ["Team meeting", "Interviewing candidates", "Learning: React 19", "Internal tools", "1:1s", "Sprint planning"],
};
const started = { bright: -91, park: -90, ruiz: -80, nimbus: -85, fern: -60, kora: -40, ali: -28, landing: -95, internal: -120 };
const endedBy = { landing: -70 };
const skipDays = new Set([`arjun|${weekday(-12)}`, `neha|${weekday(-10)}`, `karan|${weekday(-1)}`]); // missed sheets: two get backdate requests
const remainingCache = new Map();
const firstMonday = (() => { let d = day(-91); while (dow(d) !== 1) d = addDays(d, 1); return d; })();

async function remaining(key, date) {
  return call("GET", `/projects/${proj[key].id}/remaining?date=${date}`, admin);
}
async function fillDay(who, date, submit = true) {
  const n = Math.round((new Date(`${date}T00:00:00Z`) - new Date(`${todayIso}T00:00:00Z`)) / 864e5);
  const w = wfhDays.get(`${who}|${date}`);
  const lv = onLeave.get(`${who}|${date}`);
  if (lv === "full") return;
  let total = w === "full" ? 600 : w === "half" ? 555 : 510 + 15 * Math.floor(rnd() * 5);
  if (lv === "half") total = 255 + 15 * Math.floor(rnd() * 3);
  if (lv === "short") total = 390 + 15 * Math.floor(rnd() * 3);
  if (date === halfDiwali) total = 255 + 15 * Math.floor(rnd() * 2);
  let parts = plan[who].filter(([k]) => n >= started[k] && !(endedBy[k] !== undefined && n > endedBy[k]));
  if (!parts.some(([k]) => k !== "internal")) parts = [["internal", 1, "Research"]];
  const weight = parts.reduce((a, p) => a + p[1], 0);
  let left = total;
  let entries = parts.map(([k, wt, a], i) => {
    const m = i === parts.length - 1 ? left : Math.max(15, Math.round((total * wt) / weight / 15) * 15);
    left -= m;
    return { key: k, minutes: m, act: a };
  }).filter((e) => e.minutes > 0);
  const toBody = (es) => {
    const merged = new Map();
    for (const e of es) merged.set(`${e.key}|${e.act}`, { ...e, minutes: (merged.get(`${e.key}|${e.act}`)?.minutes ?? 0) + e.minutes });
    return [...merged.values()].map((e) => {
      const upwork = (e.key === "bright" || e.key === "ali") && rnd() < 0.8;
      const offline = e.key === "bright" && !upwork && rnd() < 0.5;
      const task = tasks[e.key] ? pick(tasks[e.key]) : null;
      return {
        projectId: proj[e.key].id, minutes: e.minutes, description: pick(descs[e.key]), activityTypeId: act(e.act) ?? null,
        source: upwork ? "Upwork" : "eszy", trackerId: upwork ? (e.key === "bright" ? tr1.id : tr2.id) : null,
        offline, offlineReason: offline ? "Call with the client on Zoom, not tracked in Upwork" : "", taskId: task && rnd() < 0.6 ? task.id : null,
      };
    });
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await call("PUT", "/sheets/day", tokens[who], { date, entries: toBody(entries) }, { quiet: true });
      break;
    } catch (e) {
      if (e.status !== 409 || attempt === 2) throw e;
      // Over a cap: keep what fits, move the rest to internal time.
      const next = [];
      let moved = 0;
      const room = new Map();
      for (const en of entries) {
        if (en.key === "internal") { next.push(en); continue; }
        if (!room.has(en.key)) { const r = await remaining(en.key, date); room.set(en.key, Math.max(0, Math.min(r.projectLeft ?? Infinity, r.periodLeft ?? Infinity))); }
        const fits = Math.min(en.minutes, room.get(en.key));
        room.set(en.key, room.get(en.key) - Math.floor(fits / 15) * 15);
        const keep = Math.floor(fits / 15) * 15;
        if (keep > 0) next.push({ ...en, minutes: keep });
        moved += en.minutes - keep;
      }
      if (moved > 0) next.push({ key: "internal", minutes: moved, act: "Research" });
      entries = next;
      if (!plan[who].some(([k]) => k === "internal")) await soft(call("PUT", `/projects/${proj.internal.id}/members`, admin, { memberIds: [...new Set([...Object.keys(plan).map((k) => P[k])])] }));
    }
  }
  if (submit) await call("POST", "/sheets/day/submit", tokens[who], { date });
}

let sheetsDone = 0;
for (let d = day(-91); d < todayIso; d = addDays(d, 1)) {
  if (!isWeekday(d) || holidayDates.includes(d)) continue;
  for (const who of Object.keys(plan)) {
    if (skipDays.has(`${who}|${d}`)) continue;
    await fillDay(who, d);
    sheetsDone++;
  }
  if (d === day(-71)) await soft(call("POST", `/projects/${proj.landing.id}/status`, admin, { status: "ended" }));
  if (d === weekday(-20) || d === weekday(-19)) {
    // Kora hit its cap; the Billing Manager adds a free feedback round once.
    if (!proj.kora.extraAdded) { await soft(call("POST", `/projects/${proj.kora.id}/extra-hours`, bm, { label: "Client feedback round (no charge)", minutes: 8 * H, amountMinor: 0 })); proj.kora.extraAdded = true; }
  }
  if (d === weekday(-30)) await call("POST", `/projects/${proj.bright.id}/extra-hours`, bm, { label: "New scope: blog", minutes: 20 * H, amountMinor: 40_000_00 });
}
log(`${sheetsDone} daily sheets`);

// Today: a few people have started their sheet.
for (const [who, k, a, desc] of [["employee", "ruiz", "Development", "Client login screens"], ["neha", "fern", "Development", "Reminder scheduling"], ["pm", "internal", "Meeting", "Weekly planning"]]) {
  if (!isWeekday(todayIso)) break;
  await soft(call("PUT", "/sheets/day", tokens[who], { date: todayIso, entries: [{ projectId: proj[k].id, minutes: 180, description: desc, activityTypeId: act(a) }] }));
}

// ---------------------------------------------------------------- approvals
const approveOlder = async (tok, cutoff) => {
  for (let i = 0; i < 20; i++) {
    const waiting = list(await call("GET", `/approvals/sheets?status=submitted&to=${cutoff}`, tok)).filter((s) => s.date < cutoff);
    if (!waiting.length) break;
    const ids = waiting.slice(0, 200).map((s) => s.id);
    await call("POST", "/approvals/sheets/bulk", tok, { ids, action: "approve" });
  }
};
const cutoff = weekday(-2);
await approveOlder(tokens.tl, cutoff);
await approveOlder(tokens.vikram, cutoff);
await approveOlder(admin, cutoff);
// Arjun's sheet from last week is sent back with a note to add detail.
const arjunSheet = list(await call("GET", `/approvals/sheets?status=submitted`, tokens.vikram)).find((s) => s.user_id === P.arjun && s.date >= cutoff);
if (arjunSheet) await call("POST", `/approvals/sheets/${arjunSheet.id}/reject`, tokens.vikram, { reason: "Please split the Parkside hours by ticket" });
await sql(`UPDATE sheets SET submitted_at = (date::timestamp + interval '19 hours') AT TIME ZONE 'Asia/Kolkata',
           decided_at = CASE WHEN status IN ('approved','rejected') THEN (date::timestamp + interval '1 day 11 hours') AT TIME ZONE 'Asia/Kolkata' ELSE decided_at END
           WHERE tenant_id = $1 AND submitted_at IS NOT NULL`, [tenantId]);
log("sheets approved, a few left waiting");

// Back to the normal 7-day edit window; missed days now need a backdate request.
await call("PUT", "/settings", admin, { policies: { sheetEditDays: 7 } });
const req1 = await soft(call("POST", "/sheet-requests", tokens.arjun, { date: weekday(-12), reason: "I was at the client's office all day and forgot to fill it" }));
const req2 = await soft(call("POST", "/sheet-requests", tokens.neha, { date: weekday(-10), reason: "Laptop was in repair that evening" }));
if (req2) { await soft(call("POST", `/sheet-requests/${req2.id}/approve`, tokens.vikram)); await soft(fillDay("neha", weekday(-10))); }
void req1;

// ---------------------------------------------------------------- invoices, payments, refunds
// The Ali Traders migration is finished: ending it issues the final invoice for its hours.
await call("POST", `/projects/${proj.ali.id}/status`, admin, { status: "ended" });
for (const k of Object.keys(proj)) await soft(call("POST", `/projects/${proj[k].id}/run-billing`, bm));
// The API dates billing runs "today"; give past invoices the dates they would have had.
await sql(`UPDATE invoices i SET issue_date = i.period_end + 1, due_date = i.period_end + 1 + coalesce(p.due_days, 7)
           FROM projects p WHERE p.id = i.project_id AND i.tenant_id = $1 AND i.kind = 'postpaid' AND i.period_end IS NOT NULL AND i.period_end < $2`, [tenantId, todayIso]);
await sql(`UPDATE invoices i SET issue_date = $3, due_date = $3::date + 7 FROM billing_lines bl
           WHERE i.tenant_id = $1 AND i.kind = 'extra' AND i.issue_date = $2 AND i.subtotal_minor = 4000000`, [tenantId, todayIso, weekday(-30)]);
await sql("UPDATE invoices SET created_at = (issue_date::timestamp + interval '9 hours') AT TIME ZONE 'Asia/Kolkata' WHERE tenant_id = $1", [tenantId]);
// Number invoices in date order.
await sql(`WITH o AS (SELECT id, row_number() OVER (ORDER BY issue_date, created_at, id) AS n FROM invoices WHERE tenant_id = $1)
           UPDATE invoices i SET number = 'TMP-' || o.n FROM o WHERE o.id = i.id`, [tenantId]);
await sql(`WITH o AS (SELECT id, row_number() OVER (ORDER BY issue_date, created_at, id) AS n FROM invoices WHERE tenant_id = $1)
           UPDATE invoices i SET number = 'INV-' || lpad(o.n::text, 4, '0') FROM o WHERE o.id = i.id`, [tenantId]);
await sql("UPDATE invoice_sequences SET next_value = (SELECT count(*) + 1 FROM invoices WHERE tenant_id = $1) WHERE tenant_id = $1", [tenantId]);
await sql("UPDATE projects SET created_at = (start_date::timestamp + interval '10 hours') AT TIME ZONE 'Asia/Kolkata' WHERE tenant_id = $1 AND start_date IS NOT NULL", [tenantId]);

const invoices = list(await call("GET", "/invoices?tab=all", bm)).sort((a, b) => (a.issue_date < b.issue_date ? -1 : 1));
const methods = ["bank_transfer", "bank_transfer", "upi", "upwork", "card"];
const leaveUnpaid = new Set();
const parkInv = invoices.filter((i) => i.project_id === proj.park.id);
// Two Parkside weeks stay overdue; one recent BrightCart and one Nimbus invoice are partly paid; the newest are unpaid.
parkInv.slice(-4, -2).forEach((i) => leaveUnpaid.add(i.id));
const lastOf = (k) => invoices.filter((i) => i.project_id === proj[k].id && i.status !== "cancelled").at(-1);
const partial = new Set([lastOf("nimbus")?.id, lastOf("bright")?.id].filter(Boolean));
for (const inv of invoices) {
  if (inv.status === "cancelled" || leaveUnpaid.has(inv.id)) continue;
  const total = Number(inv.total_minor);
  let paidBy = addDays(inv.issue_date, 3 + Math.floor(rnd() * 14));
  if (paidBy >= todayIso && inv.due_date < todayIso) paidBy = day(-1 - Math.floor(rnd() * 4)); // paid late, but paid
  if (partial.has(inv.id)) {
    await soft(call("POST", `/invoices/${inv.id}/payments`, bm, { amountMinor: Math.round(total * 0.4), receivedOn: addDays(inv.issue_date, 3) < todayIso ? addDays(inv.issue_date, 3) : day(-1), method: "bank_transfer", reference: "Part payment" }));
    continue;
  }
  if (paidBy >= todayIso || inv.due_date >= todayIso) {
    // Some clients pay before the due date.
    if (inv.issue_date < day(-2) && (rnd() < 0.5 || inv.project_id === proj.park.id)) {
      const on = addDays(inv.issue_date, 1 + Math.floor(rnd() * Math.max(1, (new Date(`${todayIso}T00:00:00Z`) - new Date(`${inv.issue_date}T00:00:00Z`)) / 864e5 - 1)));
      await soft(call("POST", `/invoices/${inv.id}/payments`, bm, { amountMinor: total, receivedOn: on < todayIso ? on : day(-1), method: pick(methods), reference: `TXN${Math.floor(rnd() * 1e8)}` }));
    }
    continue;
  }
  const m = inv.project_id === proj.bright.id || inv.project_id === proj.ali.id ? "upwork" : pick(methods);
  if (rnd() < 0.15) {
    await soft(call("POST", `/invoices/${inv.id}/payments`, bm, { amountMinor: Math.round(total * 0.5), receivedOn: paidBy, method: m, reference: `TXN${Math.floor(rnd() * 1e8)}` }));
    await soft(call("POST", `/invoices/${inv.id}/payments`, bm, { amountMinor: total - Math.round(total * 0.5), receivedOn: addDays(paidBy, 6) < todayIso ? addDays(paidBy, 6) : day(-1), method: m, reference: `TXN${Math.floor(rnd() * 1e8)}` }));
  } else {
    await soft(call("POST", `/invoices/${inv.id}/payments`, bm, { amountMinor: total, receivedOn: paidBy, method: m, reference: m === "upwork" ? `Upwork payout ${Math.floor(rnd() * 1e6)}` : `TXN${Math.floor(rnd() * 1e8)}` }));
  }
}
// A paid Parkside week is refunded after a disputed ticket.
const toRefund = parkInv.find((i) => !leaveUnpaid.has(i.id) && i.due_date < day(-20));
if (toRefund) await soft(call("POST", `/invoices/${toRefund.id}/refund`, bm, { refundedOn: addDays(toRefund.due_date, 5), reason: "Client disputed the hours for a ticket that was their own bug; refunded in full" }));
// A wrong manual invoice is cancelled and corrected.
const manual = await call("POST", "/invoices", bm, { projectId: proj.ruiz.id, issueDate: day(-3), lines: [{ description: "Domain and hosting for one year", amountMinor: 15_000_00 }] });
await call("POST", `/invoices/${manual.id}/cancel`, bm, { reason: "Wrong amount: hosting is 12,000 for the year" });
await call("POST", `/invoices/${manual.id}/correct`, bm, { issueDate: day(-3), lines: [{ description: "Domain and hosting for one year", minutes: 0, amountMinor: 12_000_00 }] });
const newest = list(await call("GET", "/invoices?tab=all", bm)).find((i) => i.status === "unpaid");
if (newest) await soft(call("POST", `/invoices/${newest.id}/send`, bm, { to: "accounts@client.test" }));

for (const [k, d, desc, amt] of [
  ["bright", -80, "Shopify theme licence", 18_000_00], ["bright", -60, "Upwork service fee (Sept)", 32_000_00], ["bright", -30, "Upwork service fee (Oct)", 28_500_00],
  ["fern", -45, "Apple developer account", 8_700_00], ["fern", -20, "Device testing (BrowserStack)", 12_400_00], ["nimbus", -50, "Google Maps API credits", 9_800_00],
  ["kora", -35, "Stock photography", 6_500_00], ["ali", -20, "Upwork service fee", 7_200_00], [null, -40, "Figma team plan", 14_000_00], [null, -10, "Office internet", 4_500_00],
]) await call("POST", "/expenses", bm, { projectId: k ? proj[k].id : null, date: day(d), description: desc, amountMinor: amt });
log(`${invoices.length + 2} invoices with payments, a refund and a correction; expenses`);

// ---------------------------------------------------------------- workspace: standups, events, assets, notes, comments
for (const [who, yday, today, block, keys] of [
  ["employee", "Finished checkout validation", "Order confirmation emails", "Waiting for Mia to share email copy", ["bright"]],
  ["karan", "Product import script handles variants now", "Customer import and redirects", "", ["ali", "bright"]],
  ["priya", "Kora checkout screens", "Ruiz blog templates", "", ["ruiz", "kora"]],
  ["tl", "Reviewed six pull requests", "Parkside tickets and sprint planning", "", ["park"]],
  ["vikram", "Dispatcher map clustering", "Fernwood integrations planning", "Need NHS login sandbox access", ["nimbus", "fern"]],
  ["neha", "Push notifications on Android", "Push notifications on iOS", "Apple certificate expired; asked Dev to renew", ["nimbus"]],
  ["arjun", "Booking flow edge cases", "Parkside Node upgrade", "", ["fern", "park"]],
]) {
  await soft(call("PUT", "/standups", tokens[who], { yesterday: yday, today, blockers: block, projectIds: keys.map((k) => proj[k].id) }));
  await soft(call("PUT", "/standups", tokens[who], { date: weekday(-1), yesterday: "Code review and fixes", today: yday, blockers: "", projectIds: keys.map((k) => proj[k].id) }));
}
for (const e of [
  { title: "Quarterly town hall", kind: "meeting", startDate: weekday(2, 1), startTime: "16:00", endTime: "17:00", description: "Results for the quarter and plans for the next one" },
  { title: "Team outing: bowling", kind: "celebration", startDate: weekday(9, 1), description: "Leave at 4 pm, dinner after" },
  { title: "React Native workshop", kind: "training", startDate: weekday(5, 1), startTime: "14:00", endTime: "16:00", audience: "team", teamId: mobileTeam.id },
  { title: "Fernwood launch review", kind: "meeting", startDate: weekday(12, 1), startTime: "11:00", endTime: "12:00" },
  { title: "Security awareness training", kind: "training", startDate: weekday(-14), startTime: "15:00", endTime: "16:00" },
  { title: "Diwali celebration", kind: "celebration", startDate: weekday(-4), description: "Sweets and rangoli in the office" },
  { title: "Sales pipeline review", kind: "meeting", startDate: weekday(1, 1), startTime: "10:00", endTime: "10:30", audience: "department", departmentId: dept.Sales },
]) await call("POST", "/events", admin, e);

const asset = async (b, who, on, ret) => {
  const a = await call("POST", "/assets", admin, b);
  if (who) await call("POST", `/assets/${a.id}/assign`, admin, { userId: P[who], on: on ?? day(-200), notes: "Issued on joining" });
  if (ret) await call("POST", `/assets/${a.id}/return`, admin, { on: ret.on, condition: ret.condition, notes: ret.notes });
  return a;
};
let sn = 1000;
for (const who of ["employee", "karan", "priya", "tl", "vikram", "neha", "arjun", "pm", "billing", "sales", "meera"]) {
  await asset({ name: who === "priya" ? "MacBook Pro 14\" M3" : "MacBook Air M3", category: "Laptop", brand: "Apple", vendor: "Imagine Store, Bengaluru", warrantyMonths: who === "karan" ? 12 : 24, serialNumber: `C02X${sn++}`, purchasedOn: day(-400), costMinor: who === "priya" ? 1_99_900_00 : 1_14_900_00 }, who);
}
await asset({ name: "Dell 27\" monitor", category: "Monitor", serialNumber: "DL27-889", costMinor: 24_000_00 }, "employee");
await asset({ name: "Dell 27\" monitor", category: "Monitor", serialNumber: "DL27-890", costMinor: 24_000_00 });
await asset({ name: "iPhone 15 (test device)", category: "Phone", serialNumber: "IP15-TEST-1", costMinor: 69_900_00 }, "neha");
await asset({ name: "Pixel 8 (test device)", category: "Phone", serialNumber: "PX8-TEST-1", costMinor: 59_900_00 }, "arjun");
await asset({ name: "ThinkPad T14", category: "Laptop", serialNumber: "TP14-2231", costMinor: 89_000_00, purchasedOn: day(-900) }, "karan", day(-700), { on: day(-120), condition: "damaged", notes: "Hinge cracked; returned when Rohan left" });
await asset({ name: "Logitech MX Keys", category: "Keyboard", brand: "Logitech", vendor: "Amazon", serialNumber: "LGMX-4410", costMinor: 9_500_00, purchasedOn: day(-200), warrantyMonths: 12 }, "priya");
const issueAsset = (await sql("SELECT id FROM assets WHERE tenant_id = $1 AND assigned_to = $2 AND category = 'Laptop' LIMIT 1", [tenantId, P.karan])).rows[0]?.id;
if (issueAsset) await soft(call("POST", "/asset-requests", tokens.karan, { kind: "issue", assetId: issueAsset, priority: "high", details: "Battery drains in under two hours and the laptop gets very hot." }));
const reqNew = await soft(call("POST", "/asset-requests", tokens.priya, { kind: "new", category: "Drawing tablet", priority: "medium", details: "For the Kora illustrations; a Wacom Intuos would do." }));
if (reqNew) await soft(call("POST", `/asset-requests/${reqNew.id}/decide`, admin, { status: "in_progress", response: "Ordered, arriving next week" }));
await soft(call("POST", "/asset-requests", tokens.arjun, { kind: "new", category: "Monitor", priority: "low", details: "A second screen for testing on two devices." }));

for (const [k, title, body, pinned, by] of [
  ["bright", "Client prefers Slack", "Mia answers fastest on Slack. Send a weekly report every Friday with hours used and next week's plan.", true, bm],
  ["bright", "Staging access", "Staging store: brightcart-staging.myshopify.com. Password is in the team vault.", false, tokens.pm],
  ["park", "Ticket rules", "Only tickets raised in their Zendesk count as billable. Calls about our own bugs are not billable.", true, tokens.pm],
  ["fern", "Milestone sign-off", "Sara signs off each milestone by email before we invoice it.", true, bm],
  ["nimbus", "Monthly hours", "320 hours a month. Anything above needs Kabir's written OK.", true, tokens.pm],
]) await soft(call("POST", `/projects/${proj[k].id}/notes`, by, { title, body, pinned }));
for (const [k, who, body] of [
  ["bright", "employee", "Checkout design approved by Mia today."], ["bright", "tl", "Filters are live on staging. Please test on mobile."],
  ["fern", "arjun", "Booking flow handles clinic holidays now."], ["nimbus", "neha", "Android build uploaded to Play internal testing."],
  ["kora", "priya", "Shared the final menu designs with Yusuf."], ["ali", "karan", "All 2,014 products imported. 3 had broken images, listed in the sheet."],
]) await soft(call("POST", `/projects/${proj[k].id}/comments`, tokens[who], { body }));
for (const [tok, n] of [
  [admin, { title: "Office hours", body: "Office is open 9:30 to 7. Core hours 11 to 5. Lock the server room when you leave.", visibility: "everyone", pinned: true, color: "green" }],
  [admin, { title: "Diwali week", body: "Half day on Diwali. Sweets in the pantry on Thursday.", visibility: "everyone", color: "amber" }],
  [tokens.employee, { title: "BrightCart checklist", body: "• Test checkout on Safari\n• Ask Mia for email copy\n• Update the Friday report", color: "blue" }],
  [tokens.pm, { title: "Hiring", body: "Two React Native interviews next week. Vikram to take the technical round.", pinned: true }],
]) await soft(call("POST", "/notes", tok, n));
log("standups, calendar, accessories, notes and comments");

// ---------------------------------------------------------------- alerts
for (const r of [
  { event: "project.near_cap", threshold: 80, roleKeys: ["billing_manager", "project_manager"], inApp: true, email: true },
  { event: "invoice.overdue", threshold: 3, roleKeys: ["billing_manager"], notifyOwner: true, inApp: true, email: true },
  { event: "sheet.pending", threshold: 2, roleKeys: ["team_lead"], inApp: true },
  { event: "lead.converted", roleKeys: ["sales_tl"], inApp: true },
  { event: "payment.recorded", roleKeys: ["admin"], inApp: true, active: false },
]) await soft(call("POST", "/alert-rules", admin, r));
log("alert rules");

// ---------------------------------------------------------------- platform console
const pEmail = process.env.PLATFORM_ADMIN_EMAIL ?? "owner@eszy.com";
const pPass = process.env.PLATFORM_ADMIN_PASSWORD ?? "change-me-now";
const platform = await call("POST", "/platform/login", null, { email: pEmail, password: pPass }, { tenant: null, quiet: true }).catch(() => null);
if (platform?.accessToken) {
  const pt = platform.accessToken;
  const pc = (m, p, b) => call(m, `/platform${p}`, pt, b, { tenant: null });
  await soft(pc("PUT", "/billing-profile", { legalName: "eszy Technologies Pvt Ltd", address: "HSR Layout, Bengaluru 560102", country: "IN", state: "Karnataka", taxId: "29AAFCE9876K1Z4", rates: [{ name: "GST", rateBp: 1800 }], indiaGstSplit: true, exportRateBp: 0 }));
  const plans = list(await pc("GET", "/plans"));
  const code = (i) => plans[Math.min(i, plans.length - 1)]?.code;
  for (const [slug, name, owner, email, pi, status, currency, country] of [
    ["northwind", "Northwind Creative", "Olivia Grant", "olivia@northwind.test", 2, "active", "USD", "US"],
    ["pixelpine", "Pixel & Pine", "Rhea Kapoor", "rhea@pixelpine.test", 1, "trial", "INR", "IN"],
    ["bluefin", "Bluefin Labs", "Marco Rossi", "marco@bluefin.test", 1, "past_due", "EUR", "IT"],
    ["atlas", "Atlas Outsourcing", "Imran Qureshi", "imran@atlas.test", 0, "cancelled", "INR", "IN"],
  ]) {
    const r = await soft(pc("POST", "/tenants", { slug, name, planCode: code(pi), ownerName: owner, ownerEmail: email, currency, country, active: status === "active" }));
    if (!r) continue;
    if (status !== "active" && status !== "trial") await soft(pc("PUT", `/tenants/${r.tenantId}`, { status }));
    if (status === "active") for (let m = 3; m >= 1; m--) await soft(pc("POST", `/tenants/${r.tenantId}/invoices`, { amountMinor: 249_00, currency, periodStart: day(-30 * m), periodEnd: day(-30 * m + 29), description: `${name}: Business plan, 10 seats` }));
  }
  for (let m = 3; m >= 1; m--) await soft(pc("POST", `/tenants/${tenantId}/invoices`, { amountMinor: 24_900_00, currency: "INR", periodStart: day(-30 * m), periodEnd: day(-30 * m + 29), description: "Demo Studio: Business plan, 25 seats" }));
  await sql("UPDATE subscription_invoices SET created_at = (period_start::timestamp + interval '9 hours') WHERE period_start IS NOT NULL").catch(() => {});
  log("platform console: companies, invoices and billing profile");
} else {
  log("platform console skipped (couldn't sign in as the platform admin)");
}
for (const e of [
  { name: "Kavya Menon", company: "Orbit Interactive", email: "kavya@orbit.test", teamSize: "11 to 50", features: "People and Time, Projects and Billing", message: "We bill most clients through Upwork and lose track of caps." },
  { name: "Daniel Brooks", company: "Brooks & Co Digital", email: "dan@brooks.test", teamSize: "51 to 200", features: "People and Time, Projects and Billing, Sales CRM, Performance and Rates", message: "Need GST invoices and per-team profit." },
  { name: "Sneha Kulkarni", company: "Kulkarni Studio", email: "sneha@kulkarni.test", teamSize: "1 to 10", features: "Projects and Billing", message: "" },
]) await soft(call("POST", "/public/enquiries", null, e, { tenant: null }));

// ---------------------------------------------------------------- project board, PMs, descriptions and attachments
{
  const stages = list(await call("GET", "/lists/project-stages", admin));
  const stage = (n) => stages.find((x) => x.name === n)?.id;
  const where = { bright: "In progress", park: "In progress", nimbus: "In progress", internal: "In progress", fern: "Awaiting feedback", ruiz: "QA and review", kora: "QA and review", ali: "Complete", landing: "Complete", seo: "To do" };
  for (const [k, n] of Object.entries(where)) if (proj[k] && stage(n)) await soft(call("PUT", `/projects/${proj[k].id}/stage`, admin, { stageId: stage(n) }));
  // Two PMs on the bigger projects; Kora gets its first PM.
  const team = async (k, pmIds) => {
    const d = await call("GET", `/projects/${proj[k].id}`, admin);
    const tl = d.members.filter((m) => m.role === "tl").map((m) => m.id);
    const members = d.members.filter((m) => m.role === "member" && !pmIds.includes(m.id)).map((m) => m.id);
    await soft(call("PUT", `/projects/${proj[k].id}/members`, admin, { pmIds, tlIds: tl.filter((x) => !pmIds.includes(x)), memberIds: members }));
  };
  await team("nimbus", [P.pm, P.admin]);
  await team("bright", [P.pm, P.salestl]);
  await team("kora", [P.pm]);
  const descriptions = {
    bright: "Rebuild of BrightCart's Shopify storefront: new theme, faster checkout and product filters.\n\n- Client is hired over our Upwork agency profile\n- Communication is over Slack and Upwork messages\n- Call taken by Sana (sales) with Tarun\n- Hours estimated: 120 to 140\n- Project understanding given to Tarun and Dev\n- Staging store: https://brightcart-staging.myshopify.com",
    nimbus: "Driver and dispatcher apps (React Native) with live tracking. 320 hours a month, invoiced at the start of each month.\n\n- Hired directly after a referral from Fernwood\n- Weekly call every Monday at 11:00 with their CTO\n- Vikram leads the mobile work, Neha owns the driver app\n- Designs: https://www.figma.com/file/nimbus-fleet",
    kora: "Redesign of the online menu and ordering flow.\n\n- Fixed price, 50% advance and 50% on delivery\n- Priya owns the design, Karan builds the screens\n- Client wants the new menu live before the festive season",
  };
  for (const [k, d] of Object.entries(descriptions)) await soft(call("PUT", `/projects/${proj[k].id}`, admin, { description: d }));
  for (const [k, who, url, name] of [
    ["bright", "tl", "https://www.figma.com/file/brightcart-theme", "Theme designs (Figma)"], ["bright", "employee", "https://brightcart-staging.myshopify.com", "Staging store"],
    ["nimbus", "vikram", "https://www.figma.com/file/nimbus-fleet", "App designs"], ["nimbus", "neha", "https://trello.com/b/nimbus-sprint", "Sprint board"],
    ["kora", "priya", "https://drive.google.com/drive/folders/kora-menu-assets", "Menu photos and brand kit"],
  ]) await soft(call("POST", `/projects/${proj[k].id}/links`, tokens[who] ?? admin, { url, name }));
  const brief = "BrightCart store rebuild: brief\n\nGoals\n- Checkout under 3 steps\n- Product filters by size, colour and price\n- Lighthouse score 90+ on mobile\n";
  await fetch(`${API}/projects/${proj.bright.id}/files?name=${encodeURIComponent("BrightCart brief.txt")}&type=text/plain`, {
    method: "POST", headers: { "X-Tenant": T, Authorization: `Bearer ${tokens.tl ?? admin}`, "Content-Type": "application/octet-stream" }, body: brief,
  }).catch(() => {});
  // A sales manager added a channel straight from the client form.
  await soft(call("POST", "/lists/communication-types", admin, { name: "Microsoft Teams" }));
  log("project board, PMs, descriptions and attachments");
}

// Spread the project timeline over the last weeks instead of "just now", so sheets and changes interleave like real use.
await sql(`UPDATE audit_log SET at = now() - (random() * interval '80 days') WHERE tenant_id = $1 AND at > now() - interval '1 hour'
             AND action IN ('payment.record','invoice.update','invoice.send','billing_line.create','billing_line.update','extra_hours.add','note.create','invoice.cancel','invoice.refund','invoice.correct','project.create')`, [tenantId]).catch((e) => console.warn(e.message));
await sql(`UPDATE comments SET created_at = now() - (random() * interval '25 days') WHERE tenant_id = $1 AND created_at > now() - interval '1 hour'`, [tenantId]).catch((e) => console.warn(e.message));
await sql(`UPDATE audit_log SET at = now() - (random() * interval '60 days') WHERE tenant_id = $1 AND action IN ('task.create','project.team') AND at > now() - interval '1 hour'`, [tenantId]).catch(() => {});

// Recent notifications look fresher when spread over the last few days.
await sql(`UPDATE notifications SET created_at = now() - (random() * interval '5 days') WHERE tenant_id = $1 AND created_at > now() - interval '1 hour'`, [tenantId]).catch(() => {});
await sql(`UPDATE notifications n SET read_at = n.created_at + interval '1 hour' FROM (
             SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS r FROM notifications WHERE tenant_id = $1) x
           WHERE x.id = n.id AND x.r > 6`, [tenantId]).catch((e) => console.warn(e.message));

await db.end();
console.log("\nDemo data ready. Sign in at http://demo.localhost:5173 with any of these (password: password123):");
console.log("  admin@demo.test (Admin)       billing@demo.test (Billing Manager)   pm@demo.test (Project Manager)");
console.log("  tl@demo.test (Web team TL)    vikram@demo.test (Mobile team TL)     hr@demo.test (HR)");
console.log("  employee@demo.test, karan@, priya@, neha@, arjun@ (Employees)       sales@, meera@, salestl@ (Sales)");
