import { newId } from "../lib/ids";
import { LIMITS } from "../lib/limits";
import { CRON_BATCH } from "../loop/budget";
import type { WatchView } from "./types";

export type { WatchView };

/** A `watches` row (TDD §6.1). Times are epoch ms. */
export type WatchRow = {
  id: string;
  workspace_id: string;
  url: string;
  interval_sec: number;
  next_run: number;
  expires_at: number;
  last_status: "pass" | "fail" | null;
  consecutive_passes: number;
  open_incident_id: string | null;
};

export const toView = (w: WatchRow): WatchView => ({
  id: w.id,
  url: w.url,
  intervalSec: w.interval_sec,
  lastStatus: w.last_status,
  consecutivePasses: w.consecutive_passes,
  nextRun: w.next_run,
  expiresAt: w.expires_at,
  openIncidentId: w.open_incident_id,
});

export type CreateError = "already_watched" | "watch_limit" | "watch_capacity";
export type CreateResult = { ok: true; watch: WatchRow } | { ok: false; error: CreateError };

const TTL_MS = LIMITS.watchTtlHours * 3_600_000;

export async function listWatches(db: D1Database, workspaceId: string, now: number = Date.now()): Promise<WatchRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM watches WHERE workspace_id = ?1 AND expires_at > ?2 ORDER BY expires_at")
    .bind(workspaceId, now)
    .all<WatchRow>();
  return results;
}

/**
 * Adds a watch, first checked on the next cron tick. The caps (3 per workspace, 30 in total, one per URL per
 * workspace; TDD §5.2) are part of the INSERT, so two requests at once can't both pass them. `openIncidentId`
 * links the watch to an incident that already exists (the `add_to_watchlist` action).
 */
export async function createWatch(
  db: D1Database,
  p: { workspaceId: string; url: string; intervalSec: number; openIncidentId?: string; now?: number },
): Promise<CreateResult> {
  const now = p.now ?? Date.now();
  const w: WatchRow = {
    id: newId(),
    workspace_id: p.workspaceId,
    url: p.url,
    interval_sec: p.intervalSec,
    next_run: now,
    expires_at: now + TTL_MS,
    last_status: null,
    consecutive_passes: 0,
    open_incident_id: p.openIncidentId ?? null,
  };
  const res = await db
    .prepare(
      `INSERT INTO watches (id, workspace_id, url, interval_sec, next_run, expires_at, consecutive_passes, open_incident_id)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, 0, ?7
       WHERE NOT EXISTS (SELECT 1 FROM watches WHERE workspace_id = ?2 AND url = ?3 AND expires_at > ?5)
         AND (SELECT COUNT(*) FROM watches WHERE workspace_id = ?2 AND expires_at > ?5) < ?8
         AND (SELECT COUNT(*) FROM watches WHERE expires_at > ?5) < ?9`,
    )
    .bind(w.id, w.workspace_id, w.url, w.interval_sec, now, w.expires_at, w.open_incident_id, LIMITS.watchesPerWorkspace, LIMITS.watchesGlobal)
    .run();
  if (res.meta.changes === 1) return { ok: true, watch: w };
  return { ok: false, error: await whyRefused(db, p.workspaceId, p.url, now) };
}

async function whyRefused(db: D1Database, workspaceId: string, url: string, now: number): Promise<CreateError> {
  const mine = await listWatches(db, workspaceId, now);
  if (mine.some((w) => w.url === url)) return "already_watched";
  if (mine.length >= LIMITS.watchesPerWorkspace) return "watch_limit";
  return "watch_capacity";
}

/** True when the workspace could add a watch for `url` right now (the `add_to_watchlist` card). */
export async function canWatch(db: D1Database, workspaceId: string, url: string, now: number = Date.now()): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT NOT EXISTS (SELECT 1 FROM watches WHERE workspace_id = ?1 AND url = ?2 AND expires_at > ?3)
         AND (SELECT COUNT(*) FROM watches WHERE workspace_id = ?1 AND expires_at > ?3) < ?4
         AND (SELECT COUNT(*) FROM watches WHERE expires_at > ?3) < ?5 AS ok`,
    )
    .bind(workspaceId, url, now, LIMITS.watchesPerWorkspace, LIMITS.watchesGlobal)
    .first<{ ok: number }>();
  return row?.ok === 1;
}

export async function deleteWatch(db: D1Database, workspaceId: string, id: string): Promise<boolean> {
  const res = await db.prepare("DELETE FROM watches WHERE id = ?1 AND workspace_id = ?2").bind(id, workspaceId).run();
  return res.meta.changes === 1;
}

export async function getWatch(db: D1Database, id: string): Promise<WatchRow | null> {
  return db.prepare("SELECT * FROM watches WHERE id = ?1").bind(id).first<WatchRow>();
}

// ---- cron (TDD §8.5) ----

export async function dueWatches(db: D1Database, now: number): Promise<WatchRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM watches WHERE next_run <= ?1 AND expires_at > ?1 ORDER BY next_run LIMIT ?2")
    .bind(now, CRON_BATCH)
    .all<WatchRow>();
  return results;
}

/** Stores a check's result and schedules the next one. Returns the new run of passes in a row. */
export async function recordWatchCheck(db: D1Database, w: WatchRow, pass: boolean, now: number): Promise<number> {
  const passes = pass ? w.consecutive_passes + 1 : 0;
  await db
    .prepare("UPDATE watches SET next_run = ?2, last_status = ?3, consecutive_passes = ?4 WHERE id = ?1")
    .bind(w.id, now + w.interval_sec * 1000, pass ? "pass" : "fail", passes)
    .run();
  return passes;
}

export async function deleteExpired(db: D1Database, now: number): Promise<number> {
  return (await db.prepare("DELETE FROM watches WHERE expires_at <= ?1").bind(now).run()).meta.changes;
}

/** Links a confirmed failure's incident to the watch. Only the first claim wins, so one failure opens one incident. */
export async function claimIncident(db: D1Database, watchId: string, incidentId: string): Promise<boolean> {
  const res = await db.prepare("UPDATE watches SET open_incident_id = ?2 WHERE id = ?1 AND open_incident_id IS NULL").bind(watchId, incidentId).run();
  return res.meta.changes === 1;
}

/** Unlinks a resolved incident, so the next failure can open a new one. */
export async function releaseIncident(db: D1Database, watchId: string, incidentId: string): Promise<void> {
  await db.prepare("UPDATE watches SET open_incident_id = NULL WHERE id = ?1 AND open_incident_id = ?2").bind(watchId, incidentId).run();
}
