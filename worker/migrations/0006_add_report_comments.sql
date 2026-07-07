CREATE TABLE IF NOT EXISTS report_comments (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  author_email TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (report_id) REFERENCES reports(id)
);

CREATE INDEX IF NOT EXISTS report_comments_report_idx
ON report_comments (report_id, created_at DESC);

CREATE INDEX IF NOT EXISTS report_comments_author_idx
ON report_comments (author_email);
