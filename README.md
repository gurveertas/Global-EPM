# eszy

Multi-company (SaaS) version of EPM. Each company gets its own panel at `<company>.eszy.com`. The panel covers:

- the sales CRM
- clients
- projects with billing lines and both caps
- daily sheets approved by each person's TL
- leave and WFH
- invoices with tax, payments, refunds and cancellations
- rates, performance and reports

The eszy owner runs everything from the platform console at `admin.eszy.com`.


## What's new in this version (round 14)

- **Handover** (Team → Handover, or "Hand over" on an employee's page). Pick who hands over and who takes over, then tick what moves: projects where they're PM or Team Lead, teams they lead or manage, direct reports, open tasks and leads they call. Optionally keep the old person on the projects as a member. Admin, HR and anyone who can assign PMs/TLs can do it.
- **History is kept.** Past approvals, sheets, comments and activity keep the old person's name. Each project's Team tab has "PMs and Team Leads over time": who led, from when to when, who they handed to, how many sheets they approved and their last approval. Every handover is in the project activity ("handed the Project Manager role from X to Y"), the activity log, and the "Past handovers" list. The new person and the project team are notified.
- **Task hours on every project.** Projects with billing take task hours from their billing lines, as before. Projects without billed hours now get "Set this project's hours first": the PM sets e.g. 50 h, tasks share it out (5 × 10 h), and when the balance is 0 the task form shows "Add hours" to raise it, with a reason that shows in the activity. A task can't be created without hours, or with more than is left.
- Migration `015_handover_taskbudget.sql`: `project_role_history` (backfilled from current PMs/TLs), `handovers`, `projects.task_budget_minutes`.

## What's new in this version (round 13)

- **Tasks split the project's hours.** On a project with a cap (fixed-price estimate or billing lines), every task gets its own hours, e.g. a 50 h project split into five tasks of 10 h.
  - The Tasks tab shows the project hours, how much is given to tasks, what's left to give out and what's logged, with Add extra hours.
  - A new task must have its hours. If they don't fit, the form says "Hours balance is 0" (or how much is short). "Add extra hours" opens with the missing hours filled in. Then save the task.
  - A task's hours can't go below what's already logged on it.
  - On the timesheet each task shows its hours left. A task with none left can't be picked. Saving more than a task has left is refused with a clear message.
  - Task cards and the task list show given / logged / left with a bar.

## What's new in this version (round 12)

- **Dashboard date filter.** Pick Today, This week, Last week, This month, Last month, Last 3 months or This year, or your own dates. The money tiles, your hours, the charts, invoices by status and leads by stage follow it. With an odd number of charts, the last one takes the full width, so there are no empty gaps.
- **Org chart: add and remove people.** In edit mode, click anyone:
  - "Add someone under …" creates a new person who reports to them, in the same team and department, and sends them an invite.
  - "Make top level" removes their manager.
  - "Deactivate" takes them out of the chart.
  Their reports move up to their manager. Deactivating someone anywhere does this too. Invited people now show in the chart.
- **Vendors for accessories.** A new Vendors tab lists contact person, phone, email, website, GSTIN, address, notes, active or inactive, the number of items and the last purchase. The item form picks a vendor from the list, or you can type a new name to add one. Existing free-text vendors were converted (migration `014_vendors.sql`). A vendor with items can't be deleted; mark it inactive instead.
- **Validation everywhere.**
  - Required text can't be just spaces.
  - Emails, phone numbers and websites are checked on people, leads, clients and vendors.
  - New projects are checked against how the client pays: fixed price needs a price and a payment plan; milestones must add up to the price; installments need a count; advance + balance needs a delivery date and an advance below the price; hourly needs prepaid/postpaid and a rate. A delivery date can't be before the start date.
  - Errors now read as plain sentences ("Enter a valid email address…"). The wrong fields turn red with the message under them, and the page scrolls to the first one.
- **Dropdowns inside pop-up forms** show above the form again.

## What's new in this version (round 11)

- **Reporting managers.** Anyone set as a person's reporting manager (or who leads their team) can approve that person's sheets and leave, whatever role they have. There's also a new **Reporting Manager** role (migration `013_reporting_manager.sql`). Nobody can report to themselves or to someone below them.
- **Org chart you can edit.** Colour legend, a new **Teams** view (department → team → people, with who each reports to) and **Edit hierarchy**. In edit mode, click anyone to change who they report to, their team, department and designation. Everyone sees the result.
- **Money is hidden completely without the permission.** For people without "See amounts, rates, revenue and costs", the server strips every amount, rate, revenue, cost, profit and margin from every response, whatever the page.
- **Advance + balance takes an amount.** Enter the advance amount, or pick 25/30/40/50/60%. The percentage and the balance are worked out for you.
- **Timesheet.** New and edited entries have their own "New entry" card, and the saved sheet sits in its own card below. The day summary now includes Leave and Events (and Holiday) hours. Notes, both shared and your own, show beside the sheet. Sheet history has more stats and a filter for every column.
- **Employee page.** Money roles get an average rate strip (these dates and all time), plus what their hours earned and the margin. The role report comes first. The Sales section only shows for sales roles, or for people who did sales work in the chosen dates.
- **Activity page.** The list scrolls inside a box that fits the screen and loads more as you scroll. It has the new date range picker and a searchable person filter, and clearer wording for more kinds of change.

## What's new in this version (round 10)

- **Date filter everywhere.** One date range picker: quick ranges (Today, Yesterday, This week, Last week, This month, Last month, Last 3 months, This year), From/To boxes, a calendar, and Clear / Apply. Every list with a date column gets it automatically ("Date: Any date"). Report pages use it for their range.
- **"+ Filter" on every list.** Columns with a handful of values (status, type, client, owner, project…) can be added as filter chips. Each chip has a searchable list with counts, and × removes it. Shows "12 of 80 shown" and "Clear all".
- **New table and card design.** Search, filters, chips, the table and the pager all sit in one card. Quieter header, roomier rows, an accent bar on the hovered row, and a clear empty state when filters match nothing. Stat tiles have an icon chip, picked from the label. Inside a card they turn flat, so you don't get boxes in boxes. The card glow is softer.
- **Refunded and cancelled hours.** Hours on refunded invoices, and hours on cancelled invoices that haven't been billed again, are counted separately:
  - Timesheets report: Refunded hours and Cancelled hours tiles (click one to filter), an "Invoice" filter, an Invoice column, and an Invoice column in the Excel export
  - Team reporting: totals and per-person columns
  - Employee page: shown in the hours summary
  - Employee timesheet tab: a By project table with Logged / Billable / In-house / No work / Approved / Refunded / Cancelled columns, and an Invoice column on every entry
- **Built for more data.** The Timesheets master list now pages on the server (total count, 10–500 rows a page), with no 3,000-row cap. Totals cover every matching entry, not just the page. New indexes on time entries (by tenant/date, person, project, invoice) and on the activity log (migration `012_round10.sql`).
- **Text editor in every text area.** Toolbar: bold, italic, strikethrough, heading, bullet and numbered lists, quote, code and link, plus Write / Preview. Shortcuts Ctrl+B, Ctrl+I and Ctrl+K; lists continue when you press Enter. Text is saved as light markdown and shown formatted in comments, notes, narration, task, lead and client notes, and standups. Table cells show it as plain text. Invoice notes stay plain because they're printed on the PDF as written.

## What's new in this version (round 9)

- **Timesheet entries are labelled** (Project, Time spent, Task, Work type, Tracking, Narration) with required marks; narration is needed to submit.
- **Simple work type** (default, Settings → Work policies): Billable or In-house on client projects, In-house or No work on internal projects, with no sub-headings. Switch to "Detailed" to keep picking work types from Masters.
- **Tracking follows the project**: fixed-price and internal projects ask nothing; hourly projects must be tracked (Tracked here, Upwork, a Tracking ID…); hourly projects that allow offline hours get a Tracking switch and, when off, "Reason for offline tracking" (reasons are editable in Work policies, plus "Something else").
- **Invoice day when creating a project**: a weekly cycle asks for the weekday, a monthly one for the date (1–28 or last day), with the next dates shown. Recurring installments on fixed-price projects ask the same (every week, 2 weeks, month, 3/6 months or year).
- Rates and profit (and other two-column pages) no longer push the side card off screen; project activity is a cleaner timeline.
- Migration 011. Run `up --build` (keeps your data).

## What's new in this version (round 8)

- **Light and dark themes for everyone**: a sun/moon button in the top bar switches instantly (with a short cross-fade). The profile menu and Profile → Theme also offer Light, Dark or Match my device. The choice is remembered per person on each device; the company's Settings → Appearance theme is the default until they choose.
- Company colours for tables, page, cards and sidebar text apply to the light theme; dark keeps its own so text stays readable. Button and chart colours apply to both.
- Notes and status chips that were light-only now have dark versions; the dashboard banner has an edge in dark.

## What's new in this version (round 7)

- **Astra with Gemini**: fixes "Function call is missing a thought_signature". eszy now keeps Gemini's own reply (with its thought signatures) and sends it back on the next step, and keeps assistant messages in their exact order.
- **Deactivate and reactivate people** from Employees (the person icon on each row) or their page. Deactivating signs them out everywhere, stops sign-in and frees the seat; their history stays. Optional reason, last working day, and removal from project teams.
- **Recurring invoice schedules** (project → Billing settings, or when creating a project): every week or 2 weeks on a chosen weekday, or every month, 3 months, 6 months or year on a chosen day (1–28 or the last day), from a start date, with the next dates shown.
- **Activity everywhere**: every change is now recorded (anything a route didn't record itself is logged automatically, without passwords or keys). New **Activity** page under Company, and Activity on clients, employees, invoices and leads. Filter by kind, person, dates and text; open a line to see what changed.
- Migration 010. Run `up --build` (keeps your data).

## What's new in this version (round 6)

- Cards and tables light up under the pointer like the landing page. Tables have one tidy style: text stays on one line, long text ends in "…" and shows in full on hover, wide lists have a **Columns** picker, and every list pages with a choice of 10, 25, 50 or 100 rows.
- **Settings → Appearance**: company colours for buttons, table header and rows, sidebar, page, cards and charts, with ready-made looks and a live preview.
- Settings, Profile, Masters and Roles use a left menu that stays put while the right side scrolls. Tab rows that don't fit scroll sideways with arrows instead of a scroll bar.
- **Masters and onboarding** has its own sidebar section and permission (`masters.manage`). **Roles and permissions** has its own page with a By role view (search, "only what it has", All/None per group) and a By person view (filter by role, team, module and level, personal changes).
- Redesigned Sheet approvals (people list, day cards, selection bar), Dashboard, Profile and Pending payments (filters by status, due date, client and project). Chart axes no longer cut off their labels; chart colours follow the brand.
- Migration 009 adds the new permissions to existing roles. Run `down -v` and `up --build`, or just `up --build` to keep your data.

## What's new in this version

- **Look and feel:** black and white with a deep violet brand and a neon glow, Sora headings, a dark sidebar that collapses to icons (remembered per browser), animated page changes, tabs, drawers and counters, and an animated sign-in page. Motion turns off for people who ask their device for reduced motion.
- **Astra, the assistant:** the "Ask Astra" button in the top bar. It answers questions about hours, projects, tasks, leave, approvals, team utilization and unpaid invoices, using only what the person asking can see. When asked to change something (log time, submit a sheet, request leave or WFH, move a task, approve or send back a sheet) it prepares the change and waits for the person to press **Confirm**. Admins set its name, icon, greeting, company notes, provider (Claude, OpenAI or Gemini), model and API keys under **Settings → Assistant**. Keys are stored encrypted; only the last four characters are shown. A platform-wide fallback key can be set with `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GEMINI_API_KEY`.
- **Org chart:** Company → Org chart draws who reports to whom on a canvas (drag, zoom, search, fold branches) with a list view for keyboards and screen readers.
- **Project assignment rules:** Admin, Billing Manager and Sales TL (the new `projects.assign` permission) assign Project Managers and Team Leads. PMs and TLs add employees; a Team Lead can only add or remove people from their own team.
- **Role report on every person's page:** their team (for leads), the projects they run (PMs and TLs), leads and calls (sales), invoices and payments (billing), headcount and leave (HR).
- **Roles you can add on the spot:** type a new role name in the employee form; it starts with Employee access.
- **Pagination on every list and table**, history in a side drawer, task lists filtered to the chosen project (your own tasks first), and a reporting-manager picker limited to the chosen team.
- People at the top of the company (no reporting manager or team lead) now send their sheets to the company owner, and the owner approves their own.

After updating, run `docker compose -f docker-compose.dev.yml down -v` and then `up --build` so migrations 007 and 008 and the new demo data are applied.

## What's in the repo

| Path | What it is |
|---|---|
| `apps/api` | Express 5 API (`src/index.ts`) and the background worker (`src/worker.ts`), TypeScript |
| `apps/web` | React 19 + Vite app: the eszy.com marketing site, the company panel for every role, and the platform console on `admin.` |
| `packages/db` | SQL migrations (schema and row-level security), seed, company set-up |
| `packages/shared` | Permissions, default roles, settings schema, Zod input schemas, money and hours helpers |
| `scripts/migrate-tas` | Moves TAS's data from the current EPM (MySQL) into an eszy company |
| `scripts/demo-data.mjs` | Fills the demo company with sample activity |
| `infra/` | Dockerfiles, nginx (wildcard subdomains), Postgres role set-up |

## What each company gets

Each company gets the features below. Every feature is switched by its plan and follows the company's own settings, roles and permissions.

- **Employees and teams:**
  - employee code, designation, employment status (provisional, appointed, serving notice, inactive) and reporting manager
  - add people with an invite link or a password you set; import from CSV or a Google Sheet link, with a dry run first
  - a page per person: projects, timesheet, attendance calendar, leave and WFH, profile and accessories
  - departments and teams with a Team Lead and a reporting manager
  - profiles with photo, address, emergency contact, and probation and notice dates
  - roles and a Permissions tab
  - two-step sign-in, Google sign-in, and a session length the company sets
- **Sales and clients:** leads, callers, the call log, and conversion credited to the bringer and the converter. Clients are Upwork (with hiring ID), direct or other, and each has a page with its projects, invoices, hours by month, the people who work for it, and notes.
- **Projects:**
  - hourly (prepaid or postpaid) or fixed price
  - billing lines and both caps
  - source, account and tracking IDs (e.g. Upwork contracts) and communication channels
  - notes, comments with @mentions, and an activity feed
  - Team Leads, sales person, estimator, call person, tags, and internal (in-house) projects
  - tasks on a board or list, with priority, due date, estimate, links and comments
  - project assignments: the PM assigns TLs, each TL assigns members, with transfers between people
- **Time:**
  - daily sheets with work type, offline hours and the tracker each entry used, plus a week view and sheet history
  - work types are billable, in-house or no work (set under Settings > Masters and onboarding)
  - approval by the person's own TL
  - backdated sheet requests
  - a setting for who can reopen approved sheets
  - daily standups and a morning report a TL can copy
- **Leave:**
  - leave types with yearly or monthly credit and a carry-over limit
  - probation and notice rules, the sandwich rule, and unpaid days once the balance runs out
  - full, multi-day, half-day (first or second half) and short leave; full, half-day or hourly WFH
  - holidays, half-day holidays and non-working days, and a leave-credits report
- **Calendar:** events, holidays, leave, WFH and birthdays.
- **Accessories:** company assets with brand, vendor and warranty, who holds each one with history, and requests and issues raised by employees.
- **Notes:** private notes, or notes shared with everyone (admins and HR).
- **Billing:**
  - invoices with tax for any country, in three PDF designs
  - payments, whole-invoice refunds, and cancelling with a reason followed by a linked corrected invoice
  - due-soon and overdue notices
- **Reporting:** team reporting (utilization, billable vs in-house vs no work), sheet reporting by team, a monthly attendance grid, unfilled sheets, a master report with every filter, hours and payments, revenue, money owed and exports. Managers see their own people; admins see everyone.
- **Insights:** dashboard, rates and profit (project, client, employee, team) and performance pages.
- **Company tools:**
  - alert rules the company sets itself
  - a change history with old and new values
  - CSV import of people, teams, clients, projects, billing lines, tasks, leads, holidays, leave balances and past hours
  - CSV or Excel export of any list, plus a full export
  - backups to the company's own S3, R2, B2, Wasabi or Google Cloud Storage bucket, and restore from them
  - "delete everything now" for the owner

The platform console handles companies, plans, per-company features, Stripe and Razorpay keys, eszy's own billing details, tax invoices to companies, and sales enquiries. Console admins can also use Google sign-in and two-step sign-in.

## How company data is kept apart

- Every company table has a `tenant_id` column with a PostgreSQL row-level security policy.
- The API connects as `eszy_app`, which has no BYPASSRLS. Every request runs in a transaction that sets `app.tenant_id`, so a query can only ever see one company's rows. If the setting is missing, it sees none.
- A sign-in token is tied to its company; it is refused on any other company's address.
- Each company has its own request limit (set per plan). The worker runs at most one heavy job per company at a time, so one company can't slow the others.
- Every database query has a time limit (`DB_STATEMENT_TIMEOUT_MS`, default 15 s). Large exports stream row by row. PDF building runs in separate worker threads.

## Run it locally

### With Docker only (recommended)

You only need [Docker Desktop](https://www.docker.com/products/docker-desktop/). Node, pnpm, PostgreSQL and Redis all run inside Docker.

```bash
cd eszy
docker compose -f docker-compose.dev.yml up --build
```

The first start takes a few minutes while packages install. It is ready when the logs show `eszy API on :4000` and `Local: http://localhost:5173/`. This one command:

- starts PostgreSQL 16 and Redis 7;
- installs packages, creates the tables and seeds the plans, console login and demo company (the `setup` service, which then exits);
- runs the API, the background worker and the web app. Code changes reload on their own.

The first start also fills the demo company with about three months of sample data (the `demo` service, about three minutes; it prints "Demo data ready" and exits). Later starts skip it because the data is already there.

Everyday commands:

```bash
docker compose -f docker-compose.dev.yml up            # start (add -d to run in the background)
docker compose -f docker-compose.dev.yml down          # stop; your data is kept
docker compose -f docker-compose.dev.yml logs -f worker   # emails are printed here
docker compose -f docker-compose.dev.yml run --rm api pnpm test   # run the tests
docker compose -f docker-compose.dev.yml down -v       # stop and wipe the database and packages
```

The sample data covers every screen: 14 people in three teams with employee codes and reporting managers, 9 clients, 10 projects of every billing type (some near or at their cap), about 500 daily sheets with approvals, send-backs and backdate requests, 30 invoices (paid, part-paid, overdue, due soon, refunded, cancelled and corrected), payments and expenses, 11 leads with call history, full, half-day and short leave, hourly WFH, holidays (one half-day) and a non-working day, tasks on every board, Team Lead assignments, asset requests, shared and private notes, events, birthdays, standups, accessories, project notes, alert rules, and four more companies plus sales enquiries in the platform console. To start over, run `down -v`, then `up --build`. Do this after pulling a version that adds database changes, so the new tables and the new sample data are created.

After pulling changes that add packages, run `up` again: `setup` installs them. Settings for Docker are in `docker-compose.dev.yml`, so you don't need a `.env` file. If Docker says a port "is already allocated", something on your computer already uses it. Redis is published on 6380 to avoid the usual clash. For the others, either stop what's using the port (`lsof -i :5432` shows it) or pick another one, for example `POSTGRES_HOST_PORT=5433 docker compose -f docker-compose.dev.yml up`. The app inside Docker is unaffected by these numbers.

### Without Docker for the app

You need Node.js 22 and pnpm (`corepack enable`). Start only the database and Redis in Docker, then run the app on your computer:

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d postgres redis
cp .env.development.example .env                 # Windows: copy .env.development.example .env
pnpm db:migrate
SEED_DEMO=1 pnpm db:seed                         # PowerShell: $env:SEED_DEMO=1; pnpm db:seed
pnpm dev                                         # API on :4000 and web on :5173
pnpm dev:worker                                  # second terminal: background jobs
pnpm demo                                        # sample data (about three minutes)
```

Open these addresses. Browsers send `*.localhost` to your own machine.

- **Demo company:** `http://demo.localhost:5173`.
  - Sign in as `admin@demo.test`, `billing@demo.test`, `tl@demo.test`, `employee@demo.test`, `sales@demo.test` or `salestl@demo.test`.
  - Every password is `password123`.
- **Platform console:** `http://admin.localhost:5173`. Sign in as `owner@eszy.com` / `change-me-now`.
- **Marketing site:** `http://localhost:5173` (Terms, Privacy and DPA drafts at `/terms`, `/privacy`, `/dpa`).
- **Emails:** while `MAIL_TRANSPORT=log`, emails are printed in the worker's log instead of being sent.

## Tests

```bash
pnpm test
```

This creates a fresh `eszy_test` database each run (set `TEST_ADMIN_URL` if your owner login differs). It then checks the agreed rules end to end, including:

- lead bringer, caller and converter
- prepaid invoice on the billing date with IGST
- money received before the invoice exists
- weekly billing cap and project cap
- 10 h on an approved WFH day
- approval by the employee's own TL, never twice
- $0 and paid extra hours
- partial and full payments
- whole-invoice refunds and cancellation
- project rate = (invoiced − refunded) ÷ hours
- installments, advance + balance, postpaid weekly invoicing
- leave balance
- CSV import and export
- isolation between companies
- read-only mode

## Deploy

The default target is AWS Mumbai (`ap-south-1`): RDS PostgreSQL 16, ElastiCache Redis, SES for email, and an ALB with an ACM wildcard certificate. Nothing in the code is tied to AWS: any host that runs Docker works.

1. **DNS:** point `eszy.com`, `www.eszy.com` and `*.eszy.com` at the load balancer.
2. **Environment:** `cp .env.example .env`. Fill in the secrets (`openssl rand -base64 48` for `JWT_SECRET` and `APP_ENCRYPTION_KEY`), the database URLs, and set `POSTGRES_OWNER_PASSWORD` / `POSTGRES_APP_PASSWORD` for compose.
3. **Start:** `docker compose up -d --build`, then `docker compose run --rm migrate` (applies migrations and seeds plans and the console login).
4. **Payments:** in the console under Payment keys, paste the Razorpay and Stripe keys. Add the webhook URLs it shows in each provider's dashboard:
   - Razorpay events: `subscription.*`
   - Stripe events: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`
5. **Plans:** in the console under Plans, set prices. While a plan's price is 0, companies see Contact sales instead of online payment.

Back up the platform database itself with RDS automated backups. Each company can also send its own encrypted backups to a bucket it owns (Settings, Backups).

## Moving TAS's data

```bash
MYSQL_URL=mysql://user:pass@host:3306/epm \
MIGRATION_DATABASE_URL=postgres://eszy_owner:...@host/eszy \
DATABASE_URL=postgres://eszy_app:...@host/eszy \
pnpm migrate:tas --slug tas --owner manish@your-email --dry-run
```

1. Run it with `--dry-run` first to see the counts, then without.
2. Passwords move as they are, so everyone signs in with their current password at `tas.eszy.com`.
3. Old projects arrive as hourly postpaid with one "Imported budget" line. Review each project's billing set-up afterwards.
4. Check the role mapping the script prints.

## Rules the code follows

| Area | Rule |
|---|---|
| Caps | Project cap = total hours of the billing lines. Billing cap = hours per week or month. Hours past either cap can't be saved. |
| Extra hours | Added by the Billing Manager. At $0 they are non-billable. With an amount they are billable and invoiced immediately. |
| Invoices | **Fixed price:** each billing line on its date (one-time, milestones, installments, advance + balance). **Prepaid:** on the billing date. **Recurring prepaid:** a new block every period. **Postpaid:** approved hours after each period, or when the project ends. |
| Due dates | Due date = invoice date + due days. "Due soon" uses the company setting, which each project can override. Overdue starts the day after the due date. |
| Refunds and cancelling | A refund always covers a whole invoice and marks its hours Refunded. Cancelling keeps the invoice number and frees its lines and hours to be invoiced again. It's only allowed before any payment. |
| Visibility | Only roles with `money.view` (Admin, Billing Manager) see rates, amounts, costs and payment status. |
| Subscriptions | 14-day trial. A failed renewal gives 7 days of full access, then 14 days read-only, then suspension. Data is kept for 3 months after cancelling, then deleted. |
