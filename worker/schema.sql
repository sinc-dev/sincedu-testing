-- sincedu-testing D1 schema

CREATE TABLE IF NOT EXISTS testers (
  id TEXT PRIMARY KEY,            -- uuid
  email TEXT NOT NULL UNIQUE,     -- stored lowercase
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS testers_email_idx ON testers (email);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,            -- uuid
  project TEXT NOT NULL DEFAULT 'default',
  reporter_email TEXT NOT NULL,
  reporter_name TEXT,
  title TEXT NOT NULL,
  note TEXT,
  severity TEXT,                  -- low | medium | high | critical
  status TEXT NOT NULL DEFAULT 'open',  -- open | in_progress | resolved | closed
  resolution TEXT,
  page_url TEXT,
  user_agent TEXT,
  element_selector TEXT,
  element_text TEXT,
  element_rect TEXT,              -- json {x,y,width,height}
  screenshot_key TEXT,           -- R2 key
  console_logs_key TEXT,         -- R2 key (json blob)
  network_logs_key TEXT,         -- R2 key (json blob)
  console_count INTEGER NOT NULL DEFAULT 0,
  network_count INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS reports_project_idx ON reports (project);
CREATE INDEX IF NOT EXISTS reports_reporter_idx ON reports (reporter_email);
CREATE INDEX IF NOT EXISTS reports_status_idx ON reports (status);
CREATE INDEX IF NOT EXISTS reports_deleted_idx ON reports (deleted_at);
CREATE INDEX IF NOT EXISTS reports_created_idx ON reports (created_at);

CREATE TABLE IF NOT EXISTS mcp_tokens (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  last_four TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS mcp_tokens_user_idx ON mcp_tokens (user_email);
CREATE INDEX IF NOT EXISTS mcp_tokens_hash_idx ON mcp_tokens (token_hash);
