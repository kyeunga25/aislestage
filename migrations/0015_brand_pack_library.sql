ALTER TABLE brand_packs ADD COLUMN default_cta_en TEXT NOT NULL DEFAULT '';
ALTER TABLE brand_packs ADD COLUMN approved_revision INTEGER NOT NULL DEFAULT 0 CHECK(approved_revision >= 0);
ALTER TABLE brand_packs ADD COLUMN snapshot_sha256 TEXT CHECK(snapshot_sha256 IS NULL OR length(snapshot_sha256) = 43);

CREATE UNIQUE INDEX idx_brand_packs_workspace_snapshot
ON brand_packs(workspace_id, snapshot_sha256)
WHERE snapshot_sha256 IS NOT NULL;

CREATE INDEX idx_brand_packs_workspace_created
ON brand_packs(workspace_id, created_at DESC, id DESC);
