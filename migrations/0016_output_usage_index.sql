CREATE INDEX idx_output_ledger_workspace_created
ON output_ledger(workspace_id, created_at DESC, id DESC);
