import { env } from "cloudflare:workers";
import { newId } from "../../../worker/lib/ids";
import type { WatchRow } from "../../../worker/watch/store";

/** Seeds a `watches` row directly (no caps), due now and unexpired unless told otherwise. */
export async function seedWatch(over: Partial<WatchRow> = {}): Promise<WatchRow> {
  const now = Date.now();
  const w: WatchRow = {
    id: newId(),
    workspace_id: newId(),
    url: "https://ok.example.com/",
    interval_sec: 300,
    next_run: now - 1000,
    expires_at: now + 3_600_000,
    last_status: null,
    consecutive_passes: 0,
    open_incident_id: null,
    ...over,
  };
  await env.DB.prepare(
    `INSERT INTO watches (id, workspace_id, url, interval_sec, next_run, expires_at, last_status, consecutive_passes, open_incident_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  )
    .bind(w.id, w.workspace_id, w.url, w.interval_sec, w.next_run, w.expires_at, w.last_status, w.consecutive_passes, w.open_incident_id)
    .run();
  return w;
}

export const readWatch = (id: string) => env.DB.prepare("SELECT * FROM watches WHERE id = ?1").bind(id).first<WatchRow>();

export const clearWatches = () => env.DB.prepare("DELETE FROM watches").run();
