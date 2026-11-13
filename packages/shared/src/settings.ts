import { z } from "zod";

/** Company settings, stored as one JSON document per company. Every field has a default. */
const hex = z.string().regex(/^(#[0-9a-fA-F]{6})?$/, "Use a colour like #6d28d9").optional();
export const companySettingsSchema = z.object({
  branding: z.object({
    displayName: z.string().default(""),
    logoUrl: z.string().default(""),
    primaryColor: z.string().default("#6d28d9"),
    accentColor: z.string().default("#c026d3"),
    theme: z.enum(["light", "dark", "system"]).default("light"),
    emailSenderName: z.string().default(""),
    /** Optional colours for parts of the panel. Empty means "follow the main colour". */
    colors: z.object({
      button: hex, buttonEnd: hex, buttonText: hex,
      tableHeader: hex, tableHeaderText: hex, tableRow: hex, tableRowAlt: hex, tableText: hex, tableHover: hex,
      sidebar: hex, sidebarText: hex, page: hex, card: hex,
      chart1: hex, chart2: hex, chart3: hex,
    }).partial().default({}),
  }).default({}),
  /** The in-app assistant. Its name and icon are the company's choice; the LLM key lives encrypted in its own table. */
  assistant: z.object({
    enabled: z.boolean().default(true),
    name: z.string().trim().min(1).max(30).default("Astra"),
    icon: z.enum(["sparkles", "bot", "brain", "rocket", "star", "zap", "wand", "orbit"]).default("sparkles"),
    provider: z.enum(["anthropic", "openai", "gemini"]).default("anthropic"),
    model: z.string().max(80).default(""),
    instructions: z.string().max(2000).default(""),
    greeting: z.string().max(200).default(""),
  }).default({}),
  locale: z.object({
    currency: z.string().length(3).default("USD"),
    timezone: z.string().default("Asia/Kolkata"),
    dateFormat: z.enum(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]).default("DD/MM/YYYY"),
    weekStartsOn: z.number().int().min(0).max(6).default(1),
  }).default({}),
  policies: z.object({
    workingDays: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
    dailyMinimumMinutes: z.number().int().min(0).default(510),
    wfhFullDayMinutes: z.number().int().min(0).default(600),
    wfhHalfDayMinutes: z.number().int().min(0).default(555),
    wfhNeedsApproval: z.boolean().default(true),
    sheetEditDays: z.number().int().min(0).default(7),
    approvedSheetEdit: z.enum(["none", "tl_until_invoiced", "admin"]).default("admin"),
    pendingReminderDays: z.number().int().min(0).max(30).default(2),   // remind the TL about sheets waiting this long; 0 = off
    backdateRequestHours: z.number().int().min(1).max(720).default(48), // how long an approved backdate request stays open
    requireActivityType: z.boolean().default(false),
    /** "simple": people pick Billable, In-house or No work. "detailed": they pick a work type from Masters (Development, Meeting…). */
    workTypeMode: z.enum(["simple", "detailed"]).default("simple"),
    /** The reasons people can pick when hours on an hourly project weren't tracked. */
    offlineReasons: z.array(z.string().max(80)).max(12).transform((a) => a.map((x) => x.trim()).filter(Boolean)).default(["Tracker not available", "BM manages it already", "I will track it later"]),
    /** Let people type their own reason as well as picking one. */
    offlineReasonOther: z.boolean().default(true),
    standupEnabled: z.boolean().default(true),
    sandwichRule: z.boolean().default(false),        // weekends/holidays between two leave days count as leave
    probationMonths: z.number().int().min(0).max(24).default(6),
    noticeDays: z.number().int().min(0).max(180).default(30),
    unpaidWhenNoBalance: z.boolean().default(true),  // leave past the balance becomes unpaid instead of being refused
  }).default({}),
  tax: z.object({
    country: z.string().default("IN"),
    state: z.string().default(""),
    taxId: z.string().default(""),
    legalName: z.string().default(""),
    address: z.string().default(""),
    rates: z.array(z.object({ name: z.string(), rateBp: z.number().int().min(0) })).default([{ name: "GST", rateBp: 1800 }]),
    indiaGstSplit: z.boolean().default(true),
    exportRateBp: z.number().int().min(0).default(0),
    pricesIncludeTax: z.boolean().default(false),
  }).default({}),
  invoices: z.object({
    numberPrefix: z.string().default("INV-"),
    defaultDueDays: z.number().int().min(0).default(7),
    dueSoonDays: z.number().int().min(0).max(60).default(3),
    dueSoonClientEmail: z.boolean().default(false),
    dueSoonNotifyRoles: z.array(z.string()).default(["billing_manager"]),
    footer: z.string().default(""),
    emailInvoicesToClient: z.boolean().default(false),
    template: z.enum(["classic", "modern", "minimal"]).default("classic"),
  }).default({}),
  auth: z.object({
    googleEnabled: z.boolean().default(false),
    googleRequired: z.boolean().default(false),
    googleClientId: z.string().default(""),
    googleClientSecret: z.string().default(""), // stored encrypted
    allowedEmailDomains: z.array(z.string()).default([]),
    twoFactor: z.enum(["off", "optional", "required"]).default("optional"),
    sessionDays: z.number().int().min(1).max(90).default(30),
  }).default({}),
  backups: z.object({
    enabled: z.boolean().default(false),
    provider: z.enum(["s3", "r2", "b2", "wasabi", "gcs", "other"]).default("s3"),
    endpoint: z.string().default(""),
    region: z.string().default("ap-south-1"),
    bucket: z.string().default(""),
    accessKeyId: z.string().default(""),
    secretAccessKey: z.string().default(""), // stored encrypted
    encryptionPassphrase: z.string().default(""), // stored encrypted
    schedule: z.enum(["daily", "weekly"]).default("daily"),
  }).default({}),
});
export type CompanySettings = z.infer<typeof companySettingsSchema>;
export const SECRET_SETTING_PATHS = ["auth.googleClientSecret", "backups.secretAccessKey", "backups.encryptionPassphrase"] as const;

export const defaultCompanySettings = (): CompanySettings => companySettingsSchema.parse({});

