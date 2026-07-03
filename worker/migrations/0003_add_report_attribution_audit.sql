ALTER TABLE reports ADD COLUMN updated_by_email TEXT;
ALTER TABLE reports ADD COLUMN updated_by_source TEXT;

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
