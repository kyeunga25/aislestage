PRAGMA foreign_keys = ON;

ALTER TABLE generations
ADD COLUMN review_status TEXT NOT NULL DEFAULT 'draft'
CHECK(review_status IN ('draft','approved','rejected'));

ALTER TABLE generations ADD COLUMN reviewed_at TEXT;

ALTER TABLE generations
ADD COLUMN reviewed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE generations ADD COLUMN composition_version TEXT;

ALTER TABLE generations
ADD COLUMN generation_mode TEXT
CHECK(generation_mode IS NULL OR generation_mode IN ('deterministic','assisted'));

CREATE INDEX IF NOT EXISTS idx_generations_workspace_review
ON generations(workspace_id, review_status, created_at DESC);
