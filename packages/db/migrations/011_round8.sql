-- Round 8: the simple work type (billable / in-house / no work) chosen on each sheet entry.
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS category text CHECK (category IN ('billable','inhouse','no_work'));

-- Installments can repeat on any invoice schedule (every 2 weeks, every 3 months…).
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_installment_interval_check;
ALTER TABLE projects ADD CONSTRAINT projects_installment_interval_check CHECK (installment_interval IN ('week','two_weeks','month','quarter','half_year','year'));
