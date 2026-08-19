CREATE TABLE admin_sessions (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  csrf_token_hash TEXT NOT NULL CHECK (length(csrf_token_hash) = 64),
  login_ticket_id TEXT NOT NULL UNIQUE CHECK (length(login_ticket_id) > 0),
  github_user_id TEXT NOT NULL CHECK (length(github_user_id) > 0),
  github_login TEXT NOT NULL CHECK (length(github_login) > 0),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;

CREATE INDEX admin_sessions_expiry_idx
  ON admin_sessions (expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE post_slug_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE CHECK (length(trim(slug)) > 0),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX post_slug_history_post_idx
  ON post_slug_history (post_id, created_at DESC);
