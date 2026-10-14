-- TDD §6.1: the full D1 schema from day one.
CREATE TABLE workspaces (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
CREATE TABLE incidents_index (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, target TEXT NOT NULL,
  status TEXT NOT NULL, origin TEXT NOT NULL DEFAULT 'chat',          -- chat | watch
  unread INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX idx_incidents_ws ON incidents_index(workspace_id, updated_at DESC);
CREATE TABLE watches (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, url TEXT NOT NULL,
  interval_sec INTEGER NOT NULL, next_run INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  last_status TEXT, consecutive_passes INTEGER NOT NULL DEFAULT 0, open_incident_id TEXT);
CREATE INDEX idx_watches_due ON watches(next_run);
CREATE TABLE webhooks (workspace_id TEXT PRIMARY KEY, kind TEXT NOT NULL, url_ciphertext BLOB NOT NULL,
  iv BLOB NOT NULL, url_hint TEXT NOT NULL, created_at INTEGER NOT NULL);   -- url_hint = masked display
CREATE TABLE llm_usage (day TEXT PRIMARY KEY, neurons_est INTEGER NOT NULL DEFAULT 0);
CREATE TABLE usage_counters (workspace_id TEXT NOT NULL, kind TEXT NOT NULL, window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (workspace_id, kind, window_start));  -- kind: run | voice
