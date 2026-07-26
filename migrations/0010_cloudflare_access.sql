PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'password'
  CHECK(auth_mode IN ('password','access'));

ALTER TABLE users ADD COLUMN access_subject_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_access_subject_hash
  ON users(access_subject_hash)
  WHERE access_subject_hash IS NOT NULL;
