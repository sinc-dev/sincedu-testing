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
  element_selector TEXT,         -- primary (first) picked element, kept for back-compat
  element_text TEXT,
  element_rect TEXT,              -- json {x,y,width,height}
  elements TEXT,                  -- json array of {selector,text,rect} (all picked elements)
  screenshot_key TEXT,           -- R2 key of the first/primary screenshot, kept for back-compat
  screenshot_keys TEXT,          -- json array of R2 keys (all screenshots)
  console_logs_key TEXT,         -- R2 key (json blob)
  network_logs_key TEXT,         -- R2 key (json blob)
  console_count INTEGER NOT NULL DEFAULT 0,
  network_count INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  updated_by_email TEXT,
  updated_by_source TEXT,
  fixed_at TEXT,
  fixed_by_email TEXT,
  fix_commit_sha TEXT,
  fix_commit_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS reports_project_idx ON reports (project);
CREATE INDEX IF NOT EXISTS reports_reporter_idx ON reports (reporter_email);
CREATE INDEX IF NOT EXISTS reports_status_idx ON reports (status);
CREATE INDEX IF NOT EXISTS reports_deleted_idx ON reports (deleted_at);
CREATE INDEX IF NOT EXISTS reports_created_idx ON reports (created_at);

CREATE TABLE IF NOT EXISTS report_audit_events (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  actor_source TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (report_id) REFERENCES reports(id)
);
CREATE INDEX IF NOT EXISTS report_audit_events_report_idx ON report_audit_events (report_id, created_at DESC);
CREATE INDEX IF NOT EXISTS report_audit_events_actor_idx ON report_audit_events (actor_email);

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
