import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Express, Request } from "express";

/**
 * The assistant reads and changes data by calling eszy's own API as the person who is chatting, with their own sign-in.
 * That way it can never see or do more than they could in the app: every permission, team scope and row-level rule applies.
 * The app listens on a private loopback port inside this process for these calls.
 */
let app: Express | null = null;
let base: Promise<string> | null = null;

export function registerSelf(a: Express) { app = a; }

function ensure(): Promise<string> {
  if (!app) throw new Error("App not registered for internal calls");
  base ??= new Promise((resolve) => {
    const srv = http.createServer(app!);
    srv.listen(0, "127.0.0.1", () => resolve(`127.0.0.1:${(srv.address() as AddressInfo).port}`));
    srv.unref();
  });
  return base;
}

export type SelfResult = { status: number; body: any };

export async function selfCall(req: Request, method: string, path: string, body?: unknown): Promise<SelfResult> {
  const hostPort = await ensure();
  const [host, port] = hostPort.split(":");
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  const headers: Record<string, string> = {
    // The tenant comes from the original host (or the dev header), exactly as for the person's own requests.
    host: String(req.headers.host ?? "localhost"),
    accept: "application/json",
    "x-eszy-assistant": "1",
  };
  if (req.headers.authorization) headers.authorization = String(req.headers.authorization);
  if (req.headers.cookie) headers.cookie = String(req.headers.cookie);
  if (req.headers["x-tenant"]) headers["x-tenant"] = String(req.headers["x-tenant"]);
  if (payload) { headers["content-type"] = "application/json"; headers["content-length"] = String(payload.length); }
  return new Promise((resolve, reject) => {
    const r = http.request({ host, port: Number(port), method, path: `/api/v1${path}`, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed: any = text;
        try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
        resolve({ status: res.statusCode ?? 500, body: parsed });
      });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}
