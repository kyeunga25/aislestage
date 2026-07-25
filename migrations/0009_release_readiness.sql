PRAGMA foreign_keys = ON;

ALTER TABLE workspaces
ADD COLUMN access_status TEXT NOT NULL DEFAULT 'active'
CHECK(access_status IN ('active','suspended','closed'));

UPDATE workspaces
SET access_status = CASE
  WHEN plan_status = 'active' THEN 'active'
  WHEN plan_status = 'suspended' THEN 'suspended'
  ELSE 'active'
END;

CREATE TABLE output_allowances (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  available INTEGER NOT NULL DEFAULT 0 CHECK(available >= 0),
  reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO output_allowances (workspace_id, available, reserved, updated_at)
SELECT workspace_id, available, reserved, updated_at
FROM credit_balances;

CREATE TRIGGER sync_output_allowance_insert
AFTER INSERT ON output_allowances
BEGIN
  INSERT INTO credit_balances (workspace_id, available, reserved, updated_at)
  VALUES (NEW.workspace_id, NEW.available, NEW.reserved, NEW.updated_at)
  ON CONFLICT(workspace_id) DO UPDATE SET
    available = excluded.available,
    reserved = excluded.reserved,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER sync_output_allowance_update
AFTER UPDATE ON output_allowances
BEGIN
  UPDATE credit_balances
  SET available = NEW.available,
      reserved = NEW.reserved,
      updated_at = NEW.updated_at
  WHERE workspace_id = NEW.workspace_id;
END;

CREATE TABLE output_ledger (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  generation_id TEXT,
  event_type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  provider_event_id TEXT UNIQUE,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO output_ledger (
  id, workspace_id, generation_id, event_type, amount, provider_event_id, note, created_at
)
SELECT id, workspace_id, generation_id, event_type, amount, provider_event_id, note, created_at
FROM credit_ledger;

CREATE TRIGGER sync_output_ledger_insert
AFTER INSERT ON output_ledger
BEGIN
  INSERT OR IGNORE INTO credit_ledger (
    id, workspace_id, generation_id, event_type, amount, provider_event_id, note, created_at
  ) VALUES (
    NEW.id, NEW.workspace_id, NEW.generation_id, NEW.event_type,
    NEW.amount, NEW.provider_event_id, NEW.note, NEW.created_at
  );
END;

CREATE UNIQUE INDEX IF NOT EXISTS idx_output_ledger_generation_event
ON output_ledger(generation_id, event_type)
WHERE generation_id IS NOT NULL;

ALTER TABLE generations
ADD COLUMN output_cost INTEGER NOT NULL DEFAULT 1 CHECK(output_cost >= 0);

UPDATE generations SET output_cost = credit_cost;

CREATE TABLE campaign_packs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  approved_revision INTEGER NOT NULL CHECK(approved_revision > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workspace_id, idempotency_key)
);

ALTER TABLE generations ADD COLUMN campaign_pack_id TEXT REFERENCES campaign_packs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_packs_workspace_created
ON campaign_packs(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_generations_campaign_pack
ON generations(campaign_pack_id, created_at);
