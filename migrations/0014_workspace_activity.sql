PRAGMA foreign_keys = ON;

ALTER TABLE campaign_packs
ADD COLUMN created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE workspace_activity_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK(event_type IN (
    'product_asset_uploaded',
    'product_asset_deleted',
    'campaign_pack_created',
    'generation_approved',
    'generation_rejected',
    'generation_deleted'
  )),
  subject_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_workspace_activity_created
ON workspace_activity_events(workspace_id, created_at DESC, id DESC);

CREATE TRIGGER activity_product_asset_uploaded
AFTER INSERT ON media_assets
BEGIN
  INSERT INTO workspace_activity_events (
    id, workspace_id, actor_user_id, event_type, subject_id
  ) VALUES (
    lower(hex(randomblob(16))), NEW.workspace_id, NEW.created_by_user_id,
    'product_asset_uploaded', NEW.id
  );
END;

CREATE TRIGGER activity_product_asset_deleted
AFTER DELETE ON media_assets
WHEN EXISTS (SELECT 1 FROM workspaces WHERE id = OLD.workspace_id)
BEGIN
  INSERT INTO workspace_activity_events (
    id, workspace_id, actor_user_id, event_type, subject_id
  ) VALUES (
    lower(hex(randomblob(16))), OLD.workspace_id, NULL,
    'product_asset_deleted', OLD.id
  );
END;

CREATE TRIGGER activity_campaign_pack_created
AFTER INSERT ON campaign_packs
BEGIN
  INSERT INTO workspace_activity_events (
    id, workspace_id, actor_user_id, event_type, subject_id
  ) VALUES (
    lower(hex(randomblob(16))), NEW.workspace_id, NEW.created_by_user_id,
    'campaign_pack_created', NEW.id
  );
END;

CREATE TRIGGER activity_generation_reviewed
AFTER UPDATE OF review_status ON generations
WHEN OLD.review_status = 'draft'
  AND NEW.review_status IN ('approved', 'rejected')
  AND NEW.review_status <> OLD.review_status
BEGIN
  INSERT INTO workspace_activity_events (
    id, workspace_id, actor_user_id, event_type, subject_id
  ) VALUES (
    lower(hex(randomblob(16))), NEW.workspace_id, NEW.reviewed_by_user_id,
    CASE NEW.review_status
      WHEN 'approved' THEN 'generation_approved'
      ELSE 'generation_rejected'
    END,
    NEW.id
  );
END;

CREATE TRIGGER activity_generation_deleted
AFTER DELETE ON generations
WHEN EXISTS (SELECT 1 FROM workspaces WHERE id = OLD.workspace_id)
BEGIN
  INSERT INTO workspace_activity_events (
    id, workspace_id, actor_user_id, event_type, subject_id
  ) VALUES (
    lower(hex(randomblob(16))), OLD.workspace_id, NULL,
    'generation_deleted', OLD.id
  );
END;
