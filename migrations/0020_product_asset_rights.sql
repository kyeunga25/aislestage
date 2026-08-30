PRAGMA foreign_keys = ON;

-- Keep the acknowledgement separate from the private asset row so a
-- migration-first deploy can treat existing and briefly old-Worker uploads as
-- unconfirmed without rewriting or exposing their private object metadata.
CREATE TABLE product_asset_rights_attestations (
  asset_id TEXT PRIMARY KEY REFERENCES media_assets(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  confirmed_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  attestation_version TEXT NOT NULL CHECK(attestation_version = 'commercial-use-v1'),
  confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_product_asset_rights_workspace_confirmed
ON product_asset_rights_attestations(workspace_id, confirmed_at DESC, asset_id);

CREATE TRIGGER product_asset_rights_workspace_insert
BEFORE INSERT ON product_asset_rights_attestations
WHEN NOT EXISTS (
  SELECT 1
  FROM media_assets
  WHERE id = NEW.asset_id
    AND workspace_id = NEW.workspace_id
    AND kind = 'product-source'
)
BEGIN
  SELECT RAISE(ABORT, 'product asset rights workspace mismatch');
END;

-- A later policy must use a new versioned record rather than silently
-- rewriting who confirmed this specific asset and when.
CREATE TRIGGER product_asset_rights_immutable
BEFORE UPDATE ON product_asset_rights_attestations
BEGIN
  SELECT RAISE(ABORT, 'product asset rights attestation is immutable');
END;
