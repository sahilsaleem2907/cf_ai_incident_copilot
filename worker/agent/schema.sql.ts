/**
 * IncidentAgent SQLite (TDD §6.2), created in `onStart`. Additions to the TDD sketch:
 * `incident.watch_id`/`unread`, `runs.question`/`mode`, and `checks.turn`/`seq` with a unique key so
 * `addPendingChecks` returns the same evidence IDs when a Workflow step retries.
 */
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS incident (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, target TEXT NOT NULL,
    origin TEXT NOT NULL, status TEXT NOT NULL, category TEXT, confidence TEXT, mode TEXT NOT NULL DEFAULT 'ai',
    watch_id TEXT, unread INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, run_id TEXT, role TEXT NOT NULL, content TEXT NOT NULL,
    evidence_refs_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, seq INTEGER NOT NULL UNIQUE, kind TEXT NOT NULL,
    question TEXT NOT NULL, workflow_id TEXT, status TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'ai',
    started_at INTEGER NOT NULL, finished_at INTEGER, findings_json TEXT, tool_calls INTEGER NOT NULL DEFAULT 0,
    llm_turns INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS checks (evidence_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, turn INTEGER NOT NULL,
    seq INTEGER NOT NULL, tool TEXT NOT NULL, args_json TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
    digest TEXT, raw_json TEXT, started_at INTEGER NOT NULL, finished_at INTEGER, UNIQUE (run_id, turn, seq))`,
  `CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, action_id TEXT NOT NULL,
    args_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL, workflow_id TEXT, created_at INTEGER NOT NULL,
    decided_at INTEGER, outcome_json TEXT)`,
  `CREATE TABLE IF NOT EXISTS timeline (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL,
    event_type TEXT NOT NULL, detail_json TEXT NOT NULL DEFAULT '{}')`,
  `CREATE TABLE IF NOT EXISTS monitor (id INTEGER PRIMARY KEY CHECK (id = 1), kind TEXT NOT NULL,
    ticks_left INTEGER NOT NULL, consecutive_passes INTEGER NOT NULL DEFAULT 0, schedule_id TEXT)`,
  `CREATE TABLE IF NOT EXISTS postmortem (id INTEGER PRIMARY KEY CHECK (id = 1), markdown TEXT NOT NULL,
    generated_at INTEGER NOT NULL)`,
] as const;
