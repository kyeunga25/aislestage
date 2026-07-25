PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active'
  CHECK(account_status IN ('active','suspended','deactivated'));

ALTER TABLE users ADD COLUMN account_type TEXT NOT NULL DEFAULT 'standard'
  CHECK(account_type IN ('standard','beta','test'));

UPDATE users
SET account_type = 'test'
WHERE lower(email) LIKE '%@example.test'
   OR lower(email) LIKE '%@test.invalid'
   OR lower(email) LIKE '%@example.invalid';

CREATE TABLE IF NOT EXISTS beta_invites (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  recipient_hash TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'beta' CHECK(account_type IN ('beta','test')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','used','revoked')),
  expires_at TEXT NOT NULL,
  used_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_beta_invites_recipient_status ON beta_invites(recipient_hash, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_users_account_status ON users(account_status, account_type);
