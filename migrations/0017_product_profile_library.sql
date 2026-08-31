ALTER TABLE products ADD COLUMN name_en TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN benefits_en_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE products ADD COLUMN promotion_en TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN approved_revision INTEGER NOT NULL DEFAULT 0 CHECK(approved_revision >= 0);
ALTER TABLE products ADD COLUMN snapshot_sha256 TEXT CHECK(snapshot_sha256 IS NULL OR length(snapshot_sha256) = 43);

CREATE UNIQUE INDEX idx_products_workspace_snapshot
ON products(workspace_id, snapshot_sha256)
WHERE snapshot_sha256 IS NOT NULL;

CREATE INDEX idx_products_workspace_created
ON products(workspace_id, created_at DESC, id DESC);
