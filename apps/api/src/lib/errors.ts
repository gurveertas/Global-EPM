import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "./logger";

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = "error", public details?: unknown) {
    super(message);
  }
}
export const badRequest = (m: string, details?: unknown) => new HttpError(400, m, "bad_request", details);
export const unauthorized = (m = "Sign in to continue") => new HttpError(401, m, "unauthorized");
export const forbidden = (m = "You don't have permission to do this") => new HttpError(403, m, "forbidden");
export const notFound = (m = "Not found") => new HttpError(404, m, "not_found");
export const conflict = (m: string, details?: unknown) => new HttpError(409, m, "conflict", details);

function logInternalError(err: unknown, req: Request, res: Response) {
  logger.error({
    err,
    requestId: res.locals.requestId,
    method: req.method,
    path: req.path,
    host: req.hostname,
    tenantId: req.tenant?.id,
    tenantSlug: req.tenant?.slug,
  }, "internal server error");
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: { code: "validation", message: "Some fields need fixing", fields: err.flatten().fieldErrors } });
  }
  if (err instanceof HttpError) {
    if (err.status >= 500) {
      logInternalError(err, req, res);
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details, requestId: res.locals.requestId } });
    }
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  const pgErr = err as { code?: string; detail?: string; constraint?: string };
  if (pgErr?.code === "23505") return res.status(409).json({ error: { code: "duplicate", message: "This already exists", details: pgErr.constraint } });
  if (pgErr?.code === "23503") return res.status(409).json({ error: { code: "in_use", message: "This is linked to other records", details: pgErr.constraint } });
  if (pgErr?.code === "23514") return res.status(400).json({ error: { code: "invalid", message: "Some values are not allowed", details: pgErr.constraint } });
  logInternalError(err, req, res);
  res.status(500).json({ error: { code: "server_error", message: "Something went wrong on our side", requestId: res.locals.requestId } });
}
