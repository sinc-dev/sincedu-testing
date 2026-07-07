CREATE INDEX IF NOT EXISTS reports_highlight_lookup_idx
ON reports (project, page_url, deleted_at, created_at DESC);
