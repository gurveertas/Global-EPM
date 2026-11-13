import path from "node:path";
import { fileURLToPath } from "node:url";
import { Piscina } from "piscina";
import { invoicePdf, subscriptionInvoicePdf } from "./pdf";
import { env } from "./env";

/**
 * Heavy work (PDF rendering) runs in a pool of worker threads, so a company printing many invoices
 * doesn't slow anyone else's requests. Tests and PDF_THREADS=0 render on the main thread.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const isTs = import.meta.url.endsWith(".ts");
let pool: Piscina | null = null;
function getPool() {
  if (env.NODE_ENV === "test" || process.env.PDF_THREADS === "0") return null;
  return (pool ??= new Piscina({
    filename: path.join(here, isTs ? "pdf-worker.ts" : "pdf-worker.js"),
    execArgv: isTs ? ["--import", "tsx"] : [],
    maxThreads: Number(process.env.PDF_THREADS ?? 2),
    idleTimeout: 60_000,
  }));
}

export async function renderPdf(kind: "invoice" | "subscription", ...args: any[]): Promise<Buffer> {
  const p = getPool();
  if (!p) return kind === "invoice" ? (invoicePdf as any)(...args) : (subscriptionInvoicePdf as any)(...args);
  return Buffer.from(await p.run({ kind, args }));
}
