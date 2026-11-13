// Runs inside a worker thread: turns invoice data into a PDF so the main thread stays free for requests.
import { invoicePdf, subscriptionInvoicePdf } from "./pdf";

export default async function render(task: { kind: "invoice" | "subscription"; args: any[] }) {
  const buf = task.kind === "invoice" ? await (invoicePdf as any)(...task.args) : await (subscriptionInvoicePdf as any)(...task.args);
  return new Uint8Array(buf);
}
