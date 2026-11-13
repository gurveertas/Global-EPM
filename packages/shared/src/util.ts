/** Format minor units (cents/paise) as money. */
export function formatMoney(minor: number | string | null | undefined, currency = "USD", locale = "en-IN"): string {
  const n = Number(minor ?? 0) / 100;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

/** 510 -> "8 h 30 m" */
export function formatMinutes(min: number | string | null | undefined): string {
  const m = Math.round(Number(min ?? 0));
  const h = Math.floor(Math.abs(m) / 60);
  const r = Math.abs(m) % 60;
  const sign = m < 0 ? "-" : "";
  if (!h) return `${sign}${r} m`;
  return r ? `${sign}${h} h ${r} m` : `${sign}${h} h`;
}

/** "8:30" or "8.5" -> 510 */
export function parseHours(input: string): number | null {
  const s = input.trim();
  if (/^\d+:\d{1,2}$/.test(s)) {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + m;
  }
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 60) : null;
}

export const INVOICE_STATUS_LABEL: Record<string, string> = {
  unpaid: "Unpaid",
  partially_paid: "Partially paid",
  paid: "Paid",
  refunded: "Refunded",
  cancelled: "Cancelled",
  overdue: "Overdue",
  due_soon: "Due soon",
};

export const FIXED_OPTION_INFO: Record<string, { label: string; info: string }> = {
  one_time: { label: "One-time", info: "The full price is invoiced as soon as the project is created." },
  milestones: { label: "Milestones", info: "Each billing line is a milestone with its own amount and date. Each one is invoiced on its date." },
  installments: { label: "Recurring installments", info: "The price is split into equal invoices, one every week or month, for the number of installments you set." },
  advance_balance: { label: "Advance + balance", info: "An advance amount is invoiced when the project is created. The rest is invoiced on the delivery date." },
};
