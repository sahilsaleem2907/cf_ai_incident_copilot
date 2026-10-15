import { incidentAgent } from "../agent/stub";
import { CRON_SUBREQUESTS } from "../loop/budget";
import { devAllowOrigin } from "../safety/ssrf";
import { QUICKCHECK_CAP, quickCheck, type QuickCheckResult } from "../tools/quickcheck";
import { deleteExpired, dueWatches, recordWatchCheck, type WatchRow } from "./store";

/** A watch is only checked if this much budget is left: a worst-case quick check plus one RPC or Workflow create. */
const PER_WATCH = QUICKCHECK_CAP + 2;

export type WatchParams = { watchId: string };

export type TickSummary = { checked: number; failed: number; started: number; reported: number; expired: number; deferred: number };

/** One line for the timeline and the watch row: "HTTP 200 in 85 ms" or why it failed. */
export function checkSummary(v: QuickCheckResult): string {
  return v.pass ? `HTTP ${v.status} in ${v.totalMs} ms` : `Failing: ${v.reason ?? "check failed"}${v.status ? ` (HTTP ${v.status})` : ""}`;
}

/**
 * The every-minute watch tick (TDD §8.5, D12). Due watches get a quick check (no LLM) within one subrequest
 * budget for the whole tick; whatever doesn't fit waits for the next tick. A failure with no open incident
 * starts WatchWorkflow, which confirms it before opening one. A watch with an open incident reports to it.
 */
export async function runWatchTick(env: Env, now: number = Date.now(), budget: number = CRON_SUBREQUESTS): Promise<TickSummary> {
  const out: TickSummary = { checked: 0, failed: 0, started: 0, reported: 0, expired: 0, deferred: 0 };
  out.expired = await deleteExpired(env.DB, now);
  const due = await dueWatches(env.DB, now);
  const allowOrigin = devAllowOrigin(env);
  let used = 0;

  for (const [i, w] of due.entries()) {
    if (budget - used < PER_WATCH) {
      out.deferred = due.length - i;
      break;
    }
    try {
      const v = await quickCheck(w.url, { fetch: (input, init) => fetch(input, init), cap: QUICKCHECK_CAP, ...(allowOrigin ? { allowOrigin } : {}) });
      used += v.subrequests + 1;
      out.checked++;
      if (!v.pass) out.failed++;
      const passes = await recordWatchCheck(env.DB, w, v.pass, now);
      if (w.open_incident_id) {
        await (await incidentAgent(env, w.open_incident_id)).reportWatchCheck(v.pass, passes, checkSummary(v));
        out.reported++;
      } else if (!v.pass && (await startWatchWorkflow(env, w, now))) out.started++;
    } catch (e) {
      // One bad watch doesn't stop the others.
      console.error("watch check failed", w.id, (e as Error).message);
    }
  }
  return out;
}

/** `watch-<id>-<epochMinute>`: a second create for the same minute is a duplicate and is ignored. */
export const watchWorkflowId = (watchId: string, now: number) => `watch-${watchId}-${Math.floor(now / 60_000)}`;

async function startWatchWorkflow(env: Env, w: WatchRow, now: number): Promise<boolean> {
  try {
    await env.WATCH_WORKFLOW.create({ id: watchWorkflowId(w.id, now), params: { watchId: w.id } satisfies WatchParams });
    return true;
  } catch (e) {
    if (/already exists|duplicate/i.test((e as Error).message)) return false;
    throw e;
  }
}
