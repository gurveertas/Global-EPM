import PDFDocument from "pdfkit";
import { formatMoney, formatMinutes, INVOICE_STATUS_LABEL, type CompanySettings } from "@eszy/shared";

/** Builds an invoice PDF with the company's branding and tax breakdown. */
export function invoicePdf(s: CompanySettings, inv: any, lines: any[], taxes: any[], client: any, project: any, payments: any[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const cur = inv.currency;
    const m = (v: number) => formatMoney(v, cur);
    const template = s.invoices.template ?? "classic";
    const primary = template === "minimal" ? "#222222" : s.branding.primaryColor || "#6d28d9";
    const accent = s.branding.accentColor || "#f2a93b";
    const company = s.tax.legalName || s.branding.displayName;
    const meta = [`Number: ${inv.number}`, `Date: ${inv.issue_date}`, `Due: ${inv.due_date}`, `Status: ${INVOICE_STATUS_LABEL[inv.status] ?? inv.status}`];

    if (template === "modern") {
      // Full-width colour band with the company name, an accent rule under it.
      doc.rect(0, 0, 595, 120).fill(primary);
      doc.rect(0, 120, 595, 5).fill(accent);
      doc.fillColor("#ffffff").fontSize(22).font("Helvetica-Bold").text(company, 48, 40, { width: 300 });
      doc.fontSize(9).font("Helvetica").fillColor("#dfe5fb").text([s.tax.address, s.tax.taxId ? `Tax ID: ${s.tax.taxId}` : ""].filter(Boolean).join("\n"), 48, 70, { width: 300 });
      doc.fillColor("#ffffff").fontSize(24).font("Helvetica-Bold").text("Invoice", 330, 36, { width: 217, align: "right" });
      doc.fontSize(9.5).font("Helvetica").text(meta.join("\n"), 330, 66, { width: 217, align: "right" });
      doc.y = 140;
    } else if (template === "minimal") {
      doc.fillColor("#111").fontSize(16).font("Helvetica-Bold").text(company, 48, 52);
      doc.fillColor("#555").fontSize(9).font("Helvetica").text([s.tax.address, s.tax.taxId ? `Tax ID: ${s.tax.taxId}` : ""].filter(Boolean).join("\n"), { width: 260 });
      doc.fillColor("#111").fontSize(11).font("Helvetica").text(`Invoice ${inv.number}`, 330, 52, { width: 217, align: "right" });
      doc.fillColor("#555").fontSize(9).text(meta.slice(1).join("\n"), 330, 70, { width: 217, align: "right" });
      doc.moveTo(48, 125).lineTo(547, 125).strokeColor("#cccccc").stroke();
      doc.y = 135;
    } else {
      doc.fillColor(primary).fontSize(22).font("Helvetica-Bold").text(company, 48, 48);
      doc.fillColor("#444").fontSize(9).font("Helvetica").text(s.tax.address || "", { width: 260 });
      if (s.tax.taxId) doc.text(`Tax ID: ${s.tax.taxId}`);
      doc.fillColor(primary).fontSize(26).font("Helvetica-Bold").text("INVOICE", 330, 48, { width: 217, align: "right" });
      doc.fillColor("#222").fontSize(10).font("Helvetica").text(meta.join("\n"), 330, 82, { width: 217, align: "right" });
    }

    doc.moveDown(2);
    const y0 = Math.max(doc.y, 150);
    doc.fillColor("#666").fontSize(9).text("BILL TO", 48, y0);
    doc.fillColor("#222").fontSize(11).font("Helvetica-Bold").text(client.company || client.name);
    doc.font("Helvetica").fontSize(9).text([client.company ? client.name : "", client.address, client.email, client.tax_id ? `Tax ID: ${client.tax_id}` : ""].filter(Boolean).join("\n"), { width: 260 });
    doc.fillColor("#666").fontSize(9).text("PROJECT", 330, y0);
    doc.fillColor("#222").fontSize(11).font("Helvetica-Bold").text(project.name, 330, doc.y, { width: 217 });
    if (inv.period_start || inv.period_end) doc.font("Helvetica").fontSize(9).text(`Period: ${inv.period_start ?? ""} to ${inv.period_end ?? ""}`, 330, doc.y, { width: 217 });

    let y = Math.max(doc.y, y0 + 70) + 20;
    if (template === "minimal") { doc.moveTo(48, y + 21).lineTo(547, y + 21).strokeColor("#222222").stroke(); doc.fillColor("#222"); }
    else { doc.rect(48, y, 499, 22).fill(primary); doc.fillColor("#fff"); }
    doc.fontSize(9).font("Helvetica-Bold").text("Description", 56, y + 7).text("Hours", 360, y + 7, { width: 60, align: "right" }).text("Amount", 440, y + 7, { width: 100, align: "right" });
    y += 30;
    doc.font("Helvetica").fillColor("#222");
    for (const l of lines) {
      doc.text(l.description, 56, y, { width: 290 });
      const h = Math.max(doc.heightOfString(l.description, { width: 290 }), 12);
      doc.text(l.minutes ? formatMinutes(l.minutes) : "", 360, y, { width: 60, align: "right" }).text(m(l.amount_minor), 440, y, { width: 100, align: "right" });
      y += h + 8;
      doc.moveTo(48, y - 4).lineTo(547, y - 4).strokeColor("#e3e6ee").stroke();
    }
    const row = (label: string, v: string, bold = false) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").text(label, 330, y, { width: 100, align: "right" }).text(v, 440, y, { width: 100, align: "right" });
      y += 16;
    };
    y += 6;
    row("Subtotal", m(inv.subtotal_minor));
    for (const t of taxes) row(`${t.name} ${(t.rate_bp / 100).toFixed(2).replace(/\.00$/, "")}%`, m(t.amount_minor));
    row("Total", m(inv.total_minor), true);
    if (inv.paid_minor) row("Paid", m(inv.paid_minor));
    if (!["refunded", "cancelled"].includes(inv.status)) row("Balance due", m(inv.total_minor - inv.paid_minor), true);
    if (payments.length) {
      y += 10;
      doc.font("Helvetica-Bold").text("Payments received", 48, y); y += 14;
      doc.font("Helvetica");
      for (const p of payments) { doc.text(`${p.received_on}  ${m(p.amount_minor)}  ${p.reference || ""}`, 48, y); y += 13; }
    }
    if (inv.notes) { y += 12; doc.font("Helvetica").fillColor("#444").text(inv.notes, 48, y, { width: 499 }); }
    if (s.invoices.footer) doc.fontSize(8).fillColor("#777").text(s.invoices.footer, 48, 770, { width: 499, align: "center" });
    doc.end();
  });
}

/** eszy's own invoice to a company for its subscription, with the same tax engine. */
export function subscriptionInvoicePdf(inv: any, seller: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
    const m = (v: number) => formatMoney(v, inv.currency);
    doc.rect(0, 0, 595, 6).fill("#f2a93b");
    doc.fillColor("#6d28d9").fontSize(22).font("Helvetica-Bold").text(seller.legalName || "eszy", 48, 40);
    doc.fillColor("#444").fontSize(9).font("Helvetica").text([seller.address, seller.taxId ? `Tax ID: ${seller.taxId}` : ""].filter(Boolean).join("\n"), { width: 260 });
    doc.fillColor("#6d28d9").fontSize(22).font("Helvetica-Bold").text("Tax invoice", 330, 40, { width: 217, align: "right" });
    doc.fillColor("#222").fontSize(10).font("Helvetica").text([`Number: ${inv.number ?? inv.id.slice(0, 8)}`, `Date: ${String(inv.paid_at ?? inv.created_at).slice(0, 10)}`,
      inv.period_start ? `Period: ${inv.period_start} to ${inv.period_end}` : ""].filter(Boolean).join("\n"), 330, 72, { width: 217, align: "right" });
    const b = inv.bill_to ?? {};
    doc.fillColor("#666").fontSize(9).text("BILL TO", 48, 150);
    doc.fillColor("#222").fontSize(11).font("Helvetica-Bold").text(b.name ?? "");
    doc.font("Helvetica").fontSize(9).text([b.address, b.taxId ? `Tax ID: ${b.taxId}` : ""].filter(Boolean).join("\n"), { width: 260 });
    let y = 240;
    const row = (l: string, v: string, bold = false) => { doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10).text(l, 48, y, { width: 380 }).text(v, 430, y, { width: 117, align: "right" }); y += 18; };
    row(inv.description ?? "eszy subscription", m(inv.subtotal_minor ?? inv.amount_minor));
    for (const t of inv.taxes ?? []) row(`${t.name} ${t.rateBp / 100}%`, m(t.amountMinor));
    doc.moveTo(48, y).lineTo(547, y).strokeColor("#dddddd").stroke(); y += 6;
    row("Total paid", m(inv.amount_minor), true);
    doc.end();
  });
}
