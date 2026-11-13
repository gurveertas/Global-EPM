import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { authRouter } from "./routes/auth";
import { peopleRouter } from "./routes/people";
import { salesRouter } from "./routes/sales";
import { projectsRouter } from "./routes/projects";
import { timeRouter } from "./routes/time";
import { invoicesRouter } from "./routes/invoices";
import { reportsRouter } from "./routes/reports";
import { dataRouter } from "./routes/data";
import { workspaceRouter } from "./routes/workspace";
import { reportingRouter } from "./routes/reporting";
import { epmRouter } from "./routes/epm";
import { assistantRouter } from "./routes/assistant";
import { registerSelf } from "./lib/selfCall";
import { consoleRouter, publicRouter, subscriptionRouter, webhookRouter } from "./routes/platform";
import { authenticate } from "./lib/auth";
import { enforceTenantState, resolveTenant, tenantRateLimit } from "./lib/tenant";
import { errorHandler, notFound } from "./lib/errors";
import { env } from "./lib/env";
import { pool } from "./lib/context";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({
    origin: (origin, cb) => cb(null, !origin || new URL(origin).hostname.endsWith(env.BASE_DOMAIN) || new URL(origin).hostname.endsWith("localhost")),
    credentials: true,
  }));

  app.get("/health", async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  });

  // Webhooks need the raw body for signature checks, so they come before the JSON parser.
  app.use("/api/v1/webhooks", webhookRouter);
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());

  app.use("/api/v1/public", publicRouter);
  app.use("/api/v1/platform", consoleRouter);

  // Everything below belongs to one company, found from the subdomain.
  const company = express.Router();
  company.use(resolveTenant, tenantRateLimit, enforceTenantState);
  company.use("/auth", authRouter);
  company.use(authenticate);
  company.use(subscriptionRouter, peopleRouter, salesRouter, projectsRouter, timeRouter, invoicesRouter, reportsRouter, dataRouter, workspaceRouter, reportingRouter, epmRouter, assistantRouter);
  app.use("/api/v1", company);

  app.use((_req, _res, next) => next(notFound("No such endpoint")));
  app.use(errorHandler);
  registerSelf(app);
  return app;
}
