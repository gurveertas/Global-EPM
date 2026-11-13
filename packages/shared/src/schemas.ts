import { z } from "zod";

const id = z.string().uuid();
/** Text that must be filled in (spaces alone don't count). */
const required = (label: string) => z.string().trim().min(1, `${label} is required`);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Optional email, phone and website: empty is fine, anything else must look right. */
const optEmail = z.string().trim().refine((v) => !v || EMAIL.test(v), "Enter a valid email address, e.g. name@company.com").default("");
const optPhone = z.string().trim().refine((v) => !v || /^\+?[\d\s\-().]{6,20}$/.test(v), "Enter a valid phone number: digits, spaces and + - ( ) only").default("");
const optWebsite = z.string().trim().refine((v) => !v || /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(v), "Enter a valid website, e.g. company.com").default("");
const email = z.string().trim().min(1, "Email is required").refine((v) => EMAIL.test(v), "Enter a valid email address, e.g. name@company.com");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const money = z.number().int().min(0); // minor units (cents/paise)
const minutes = z.number().int().min(0);

export const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
export const signupSchema = z.object({
  companyName: z.string().min(2).max(80),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/, "Letters, numbers and hyphens, 3 to 30 characters"),
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  planCode: z.string().default("growth"),
  interval: z.enum(["month", "year"]).default("month"),
  seats: z.number().int().min(1).default(5),
  country: z.string().default("IN"),
  currency: z.string().length(3).default("INR"),
});

export const userInputSchema = z.object({
  name: required("Name").pipe(z.string().max(120, "Name is too long")),
  email,
  roleIds: z.array(id).default([]),
  teamId: id.nullable().optional(),
  phone: optPhone,
  joinedOn: date.nullable().optional(),
  departmentId: id.nullable().optional(),
  address: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: optPhone.optional(),
  dateOfBirth: date.nullable().optional(),
  probationEndsOn: date.nullable().optional(),
  noticeStartsOn: date.nullable().optional(),
  lastWorkingDay: date.nullable().optional(),
  costPerHourMinor: money.nullable().optional(),
  status: z.enum(["active", "invited", "disabled"]).optional(),
  employeeCode: z.string().max(40).optional(),
  designation: z.string().max(80).optional(),
  employmentStatus: z.enum(["provisional", "appointed", "notice", "inactive"]).optional(),
  inactiveFrom: date.nullable().optional(),
  reportingManagerId: id.nullable().optional(),
  /** Set a password straight away instead of sending an invite. */
  password: z.string().min(8, "Password must be at least 8 characters").optional(),
});

export const leadInputSchema = z.object({
  title: required("Title"),
  contactName: z.string().trim().default(""),
  email: optEmail,
  phone: optPhone,
  company: z.string().default(""),
  country: z.string().default(""),
  source: z.string().default(""),
  notes: z.string().default(""),
  estimatedValueMinor: z.number().int().min(0, "Estimated value can't be negative").nullable().optional(),
  callerId: id.nullable().optional(),
  nextFollowUpAt: z.string().nullable().optional(),
});
export const leadCallSchema = z.object({
  outcome: z.enum(["no_answer", "interested", "not_interested", "follow_up", "converted"]),
  notes: z.string().default(""),
  nextFollowUpAt: z.string().nullable().optional(),
});

export const clientInputSchema = z.object({
  name: required("Client name"),
  company: z.string().trim().default(""),
  email: optEmail,
  phone: optPhone,
  country: z.string().default("IN"),
  state: z.string().default(""),
  taxId: z.string().default(""),
  address: z.string().default(""),
  clientType: z.enum(["direct", "upwork", "other"]).default("direct"),
  hiringId: z.string().default(""),
  sourceId: id.nullable().optional(),
  accountId: id.nullable().optional(),
  communicationTypeIds: z.array(id).default([]),
  contactName: z.string().default(""),
  website: optWebsite,
  preferredBilling: z.enum(["hourly", "fixed"]).nullable().optional(),
  notes: z.string().default(""),
  status: z.enum(["active", "inactive"]).default("active"),
  /** The converted lead this client came from. */
  leadId: id.nullable().optional(),
});

export const billingLineInputSchema = z.object({
  label: required("Each billing line's name"),
  minutes,
  amountMinor: money,
  dueDate: date.nullable().optional(),
});

export const projectInputSchema = z.object({
  clientId: id,
  name: required("Project name"),
  code: z.string().trim().max(20, "Code can be 20 characters at most").default(""),
  type: z.enum(["hourly", "fixed"]),
  billingType: z.enum(["prepaid", "postpaid"]).nullable().optional(),
  invoicing: z.enum(["one_time", "recurring"]).default("one_time"),
  fixedOption: z.enum(["one_time", "milestones", "installments", "advance_balance"]).nullable().optional(),
  priceMinor: money.nullable().optional(),
  hourlyRateMinor: money.nullable().optional(),
  installmentCount: z.number().int().min(2).max(120).nullable().optional(),
  installmentInterval: z.enum(["week", "two_weeks", "month", "quarter", "half_year", "year"]).nullable().optional(),
  /** Which day installments are invoiced: a weekday (0 = Sunday) for weekly ones, a day of the month (0 = last) otherwise. */
  installmentWeekday: z.number().int().min(0).max(6).nullable().optional(),
  installmentMonthDay: z.number().int().min(0).max(28).nullable().optional(),
  /** The first installment is on the first matching day from this date (default: the start date). */
  installmentStartsOn: date.nullable().optional(),
  advancePercent: z.number().int().min(1).max(99).nullable().optional(),
  /** The advance as an amount; when given it wins over advancePercent. */
  advanceMinor: z.number().int().positive().nullable().optional(),
  deliveryDate: date.nullable().optional(),
  estimatedMinutes: minutes.nullable().optional(),   // fixed price: estimated hours (becomes the project cap)
  billingCapMinutes: minutes.nullable().optional(),
  billingPeriod: z.enum(["week", "month"]).nullable().optional(),
  billingDate: date.nullable().optional(),
  /** Recurring invoice schedule (hourly, recurring): how often and on which day invoices are created. */
  invoiceFrequency: z.enum(["week", "two_weeks", "month", "quarter", "half_year", "year"]).nullable().optional(),
  invoiceWeekday: z.number().int().min(0).max(6).nullable().optional(),
  invoiceMonthDay: z.number().int().min(0).max(28).nullable().optional(),
  invoiceStartsOn: date.nullable().optional(),
  dueDays: z.number().int().min(0).max(365).nullable().optional(),
  dueSoonDays: z.number().int().min(0).max(60).nullable().optional(),
  dueSoonClientEmail: z.boolean().nullable().optional(),
  pmUserId: id.nullable().optional(),
  pmIds: z.array(id).optional(),
  stageId: id.nullable().optional(),
  salesUserId: id.nullable().optional(),
  leadId: id.nullable().optional(),
  startDate: date.nullable().optional(),
  memberIds: z.array(id).default([]),
  sourceId: id.nullable().optional(),
  accountId: id.nullable().optional(),
  communicationTypeIds: z.array(id).default([]),
  allowOfflineHours: z.boolean().default(true),
  description: z.string().default(""),
  isInternal: z.boolean().default(false),
  estimatorUserId: id.nullable().optional(),
  callerUserId: id.nullable().optional(),
  tags: z.array(z.string().max(40)).max(20).default([]),
  tlIds: z.array(id).default([]),
  billingLines: z.array(billingLineInputSchema).default([]),
  initialPaymentMinor: money.default(0),
});
export type ProjectInput = z.infer<typeof projectInputSchema>;

/** Creating a project: the checks that depend on how the client pays. */
export const projectCreateSchema = projectInputSchema.superRefine((p, ctx) => {
  const err = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if (p.startDate && p.deliveryDate && p.deliveryDate < p.startDate) err("deliveryDate", "Delivery date can't be before the start date");
  if (p.isInternal) return;
  if (p.type === "fixed") {
    if (!p.priceMinor || p.priceMinor <= 0) err("priceMinor", "Fixed price is required");
    if (!p.fixedOption) err("fixedOption", "Pick how the fixed price is paid");
    if (p.fixedOption === "milestones") {
      if (!p.billingLines.length) err("billingLines", "Add at least one milestone");
      const sum = p.billingLines.reduce((a, l) => a + l.amountMinor, 0);
      if (p.billingLines.length && p.priceMinor && sum !== p.priceMinor) err("billingLines", "The milestones must add up to the fixed price");
    }
    if (p.fixedOption === "installments" && !p.installmentCount) err("installmentCount", "Set how many installments");
    if (p.fixedOption === "advance_balance") {
      if (!p.deliveryDate) err("deliveryDate", "Delivery date is required: the balance is invoiced on it");
      if (p.advanceMinor != null && p.priceMinor && p.advanceMinor >= p.priceMinor) err("advanceMinor", "The advance must be less than the fixed price");
    }
  } else {
    if (!p.billingType) err("billingType", "Pick prepaid or postpaid");
    if (p.hourlyRateMinor == null) err("hourlyRateMinor", "Hourly rate is required");
  }
});

export const extraHoursSchema = z.object({
  label: z.string().default("Extra hours"),
  minutes: z.number().int().min(1),
  amountMinor: money,
  dueDate: date.nullable().optional(),
  paidNowMinor: money.default(0),
});

export const timeEntryInputSchema = z.object({
  projectId: id,
  taskId: id.nullable().optional(),
  minutes: z.number().int().min(1).max(24 * 60),
  description: z.string().default(""),
  source: z.string().default("eszy"),
  activityTypeId: id.nullable().optional(),
  /** Billable, in-house or no work, when the company uses the simple work type list. */
  category: z.enum(["billable", "inhouse", "no_work"]).nullable().optional(),
  trackerId: id.nullable().optional(),
  offline: z.boolean().default(false),           // worked, but not tracked in the client's tracker
  offlineReason: z.string().default(""),
});
export const sheetSaveSchema = z.object({ date, entries: z.array(timeEntryInputSchema) });

export const leaveRequestSchema = z.object({
  leaveTypeId: id,
  startDate: date,
  endDate: date,
  halfDay: z.boolean().default(false),
  /** full day(s), morning or afternoon off, or a short leave of a few hours */
  part: z.enum(["full", "first_half", "second_half", "short"]).optional(),
  shortMinutes: z.number().int().min(15).max(300).nullable().optional(),
  reason: z.string().default(""),
});
export const wfhRequestSchema = z.object({ date, kind: z.enum(["full", "half", "hours"]), minutes: z.number().int().min(15).max(600).nullable().optional(), reason: z.string().default("") });

export const paymentSchema = z.object({
  amountMinor: z.number().int().min(1),
  receivedOn: date,
  method: z.string().default("bank_transfer"),
  reference: z.string().default(""),
});
export const refundSchema = z.object({ refundedOn: date, reason: z.string().default("") });
export const manualInvoiceSchema = z.object({
  projectId: id,
  issueDate: date,
  dueDays: z.number().int().min(0).optional(),
  lines: z.array(z.object({ description: z.string().min(1), minutes: minutes.default(0), amountMinor: money })).min(1),
  notes: z.string().default(""),
  initialPaymentMinor: money.default(0),
});
export const expenseSchema = z.object({ projectId: id.nullable().optional(), date, description: z.string().min(1), amountMinor: money });

