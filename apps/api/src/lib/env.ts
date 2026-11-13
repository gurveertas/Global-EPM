import { z } from "zod";
import { loadEnv } from "@eszy/db";

loadEnv();

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  BASE_DOMAIN: z.string().default("eszy.com"),           // companies live at <slug>.BASE_DOMAIN
  APP_URL_SCHEME: z.enum(["http", "https"]).default("https"),
  WEB_PORT_SUFFIX: z.string().default(""),               // e.g. ":5173" in local development
  JWT_SECRET: z.string().min(32).default("dev-only-secret-change-me-dev-only-secret"),
  APP_ENCRYPTION_KEY: z.string().default("dev-only-encryption-key-change-me"), // encrypts stored secrets
  ACCESS_TOKEN_MINUTES: z.coerce.number().default(15),
  REFRESH_TOKEN_DAYS: z.coerce.number().default(30),
  DEV_TENANT_HEADER: z.coerce.boolean().default(true),  // allow X-Tenant header (off in production)
  MAIL_FROM: z.string().default("eszy <no-reply@eszy.com>"),
  MAIL_TRANSPORT: z.enum(["log", "ses", "smtp"]).default("log"),
  SMTP_URL: z.string().default(""),
  AWS_REGION: z.string().default("ap-south-1"),
  SALES_EMAIL: z.string().default("sales@eszy.com"),
  LOG_LEVEL: z.string().default("info"),
  // Optional platform-wide LLM keys, used by the assistant when a company hasn't added its own.
  ANTHROPIC_API_KEY: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),
  GEMINI_API_KEY: z.string().default(""),
});

export const env = schema.parse(process.env);
export const isProd = env.NODE_ENV === "production";
if (isProd && (env.JWT_SECRET.startsWith("dev-only") || env.APP_ENCRYPTION_KEY.startsWith("dev-only"))) {
  throw new Error("Set JWT_SECRET and APP_ENCRYPTION_KEY in production");
}

export function companyUrl(slug: string, path = "") {
  return `${env.APP_URL_SCHEME}://${slug}.${env.BASE_DOMAIN}${env.WEB_PORT_SUFFIX}${path}`;
}
