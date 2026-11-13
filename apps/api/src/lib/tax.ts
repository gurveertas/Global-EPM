import type { CompanySettings } from "@eszy/shared";

export interface TaxLine { name: string; rateBp: number; amountMinor: number }

/**
 * Works out tax on an invoice subtotal from the company's tax settings and the client's location.
 * India with GST split on: same state → CGST + SGST (half each); other state → IGST; outside India → export rate.
 * Everywhere else: the company's own rates (e.g. VAT 20%), or the export rate for clients in another country.
 */
export function computeTax(
  subtotalMinor: number,
  tax: CompanySettings["tax"],
  client: { country?: string | null; state?: string | null },
): TaxLine[] {
  if (subtotalMinor <= 0) return [];
  const sameCountry = !client.country || client.country.toUpperCase() === tax.country.toUpperCase();
  const amt = (bp: number) => Math.round((subtotalMinor * bp) / 10000);
  if (!sameCountry) {
    return tax.exportRateBp > 0 ? [{ name: "Tax (export)", rateBp: tax.exportRateBp, amountMinor: amt(tax.exportRateBp) }] : [];
  }
  if (tax.country.toUpperCase() === "IN" && tax.indiaGstSplit) {
    const gst = tax.rates.find((r) => /gst/i.test(r.name)) ?? tax.rates[0];
    if (!gst) return [];
    const intra = !!tax.state && !!client.state && tax.state.trim().toLowerCase() === client.state.trim().toLowerCase();
    if (intra) {
      const half = Math.floor(gst.rateBp / 2);
      return [
        { name: "CGST", rateBp: half, amountMinor: amt(half) },
        { name: "SGST", rateBp: gst.rateBp - half, amountMinor: amt(gst.rateBp - half) },
      ];
    }
    return [{ name: "IGST", rateBp: gst.rateBp, amountMinor: amt(gst.rateBp) }];
  }
  return tax.rates.filter((r) => r.rateBp > 0).map((r) => ({ name: r.name, rateBp: r.rateBp, amountMinor: amt(r.rateBp) }));
}

/** When prices include tax, splits a gross amount into subtotal and tax. */
export function splitInclusive(grossMinor: number, totalRateBp: number) {
  const subtotal = Math.round((grossMinor * 10000) / (10000 + totalRateBp));
  return { subtotal, tax: grossMinor - subtotal };
}
