ALTER TABLE reports ADD COLUMN deleted_at TEXT;
CREATE INDEX IF NOT EXISTS reports_deleted_idx ON reports (deleted_at);
