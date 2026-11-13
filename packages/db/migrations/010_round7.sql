-- Round 7: deactivating people, recurring invoice schedules, assistant message order.

ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_reason text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

-- Messages saved within one request share now(); clock_timestamp() keeps their real order.
ALTER TABLE ai_messages ALTER COLUMN created_at SET DEFAULT clock_timestamp();

-- Recurring invoice schedule: how often and on which day invoices are created. Empty = the old behaviour
-- (follow the billing-cap period: start of each week or month).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS invoice_frequency text CHECK (invoice_frequency IN ('week','two_weeks','month','quarter','half_year','year'));
ALTER TABLE projects ADD COLUMN IF NOT EXISTS invoice_weekday int CHECK (invoice_weekday BETWEEN 0 AND 6);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS invoice_month_day int CHECK (invoice_month_day BETWEEN 0 AND 28);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS invoice_starts_on date;
