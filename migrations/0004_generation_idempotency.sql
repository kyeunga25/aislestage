PRAGMA foreign_keys = ON;

CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_ledger_generation_event
ON credit_ledger(generation_id, event_type)
WHERE generation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_generations_status_created
ON generations(status, created_at);
