PRAGMA foreign_keys = ON;

ALTER TABLE workspace_memberships
ADD COLUMN changed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX idx_workspace_memberships_workspace_created
ON workspace_memberships(workspace_id, created_at ASC, user_id ASC);

CREATE TRIGGER workspace_membership_limit
BEFORE INSERT ON workspace_memberships
WHEN (
  SELECT COUNT(*)
  FROM workspace_memberships
  WHERE workspace_id = NEW.workspace_id
) >= 50
BEGIN
  SELECT RAISE(ABORT, 'workspace membership limit reached');
END;

CREATE TABLE workspace_access_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK(event_type IN (
    'member_invited',
    'member_role_changed',
    'member_removed'
  )),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_workspace_access_events_created
ON workspace_access_events(workspace_id, created_at DESC, id DESC);

CREATE TRIGGER workspace_access_member_invited
AFTER INSERT ON workspace_memberships
WHEN NEW.changed_by_user_id IS NOT NULL
BEGIN
  INSERT INTO workspace_access_events (
    id, workspace_id, actor_user_id, target_user_id, event_type
  ) VALUES (
    lower(hex(randomblob(16))), NEW.workspace_id, NEW.changed_by_user_id,
    NEW.user_id, 'member_invited'
  );
END;

CREATE TRIGGER workspace_access_member_role_changed
AFTER UPDATE OF role ON workspace_memberships
WHEN OLD.role <> NEW.role AND NEW.changed_by_user_id IS NOT NULL
BEGIN
  INSERT INTO workspace_access_events (
    id, workspace_id, actor_user_id, target_user_id, event_type
  ) VALUES (
    lower(hex(randomblob(16))), NEW.workspace_id, NEW.changed_by_user_id,
    NEW.user_id, 'member_role_changed'
  );
END;

CREATE TRIGGER workspace_access_member_removed
AFTER DELETE ON workspace_memberships
WHEN OLD.changed_by_user_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM workspaces WHERE id = OLD.workspace_id)
BEGIN
  INSERT INTO workspace_access_events (
    id, workspace_id, actor_user_id, target_user_id, event_type
  ) VALUES (
    lower(hex(randomblob(16))), OLD.workspace_id, OLD.changed_by_user_id,
    OLD.user_id, 'member_removed'
  );
END;
