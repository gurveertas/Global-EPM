/**
 * Where an entry's hours stand with invoicing, as SQL on a time_entries row aliased "e".
 * Refunded: the invoice that billed them (directly, or through a prepaid billing line) was refunded.
 * Cancelled: they were on an invoice that was cancelled and haven't been invoiced again yet.
 */
export const REFUNDED = `(EXISTS (SELECT 1 FROM invoices ri WHERE ri.id = e.invoice_id AND ri.status = 'refunded')
  OR EXISTS (SELECT 1 FROM time_allocations ta JOIN billing_lines tb ON tb.id = ta.billing_line_id JOIN invoices ri ON ri.id = tb.invoice_id WHERE ta.entry_id = e.id AND ri.status = 'refunded'))`;
export const INVOICED = `(e.invoice_id IS NOT NULL OR EXISTS (SELECT 1 FROM time_allocations ta JOIN billing_lines tb ON tb.id = ta.billing_line_id WHERE ta.entry_id = e.id AND tb.invoice_id IS NOT NULL))`;
export const CANCELLED = `(NOT ${INVOICED} AND (e.cancelled_invoice_id IS NOT NULL
  OR EXISTS (SELECT 1 FROM time_allocations ta JOIN billing_lines tb ON tb.id = ta.billing_line_id WHERE ta.entry_id = e.id AND tb.cancelled_invoice_id IS NOT NULL)))`;
/** 'refunded' | 'cancelled' | 'invoiced' | 'not_invoiced' */
export const INVOICE_STATE = `CASE WHEN ${REFUNDED} THEN 'refunded' WHEN ${CANCELLED} THEN 'cancelled' WHEN ${INVOICED} THEN 'invoiced' ELSE 'not_invoiced' END`;
