PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS auth_attempts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL DEFAULT '',
  ip_address TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL CHECK(event_type IN ('login_failed','login_success','register_failed','register_success','rate_limited')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auth_attempts_email_ip_created ON auth_attempts(email, ip_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_attempts_ip_created ON auth_attempts(ip_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
