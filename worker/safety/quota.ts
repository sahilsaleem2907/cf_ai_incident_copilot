import { LIMITS } from "../lib/limits";
import { devAllowOrigin } from "./ssrf";

/** `retryAfter` is in seconds, for the 429 body, the `Retry-After` header and the UI's "try again in …". */
export type Quota = { ok: true } | { ok: false; retryAfter: number };

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/**
 * Fixed-window counter in D1 `usage_counters` (TDD §11). One atomic upsert per call, so two requests can't
 * both read the old count. Every call counts, refused ones too; the window still ends on time.
 */
export async function takeWindow(db: D1Database, workspaceId: string, kind: "run" | "voice", limit: number, windowMs: number, now: number): Promise<Quota> {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const row = await db
    .prepare(
      `INSERT INTO usage_counters (workspace_id, kind, window_start, count) VALUES (?1, ?2, ?3, 1)
       ON CONFLICT (workspace_id, kind, window_start) DO UPDATE SET count = count + 1 RETURNING count`,
    )
    .bind(workspaceId, kind, windowStart)
    .first<{ count: number }>();
  if ((row?.count ?? 0) <= limit) return { ok: true };
  return { ok: false, retryAfter: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)) };
}

/**
 * The single "LLM run" quota (D14): new incidents and follow-ups, 3 a minute (Rate Limiting binding) and
 * 10 an hour (D1) per workspace. Fails open: a binding or D1 error is logged and the run goes ahead, since the
 * budget guard and the Workers AI allocation still protect neurons.
 */
export async function takeRun(env: Pick<Env, "RUN_LIMIT" | "DB">, workspaceId: string, now: number = Date.now()): Promise<Quota> {
  try {
    // The binding doesn't say when its window resets, so the burst answer is the worst case: a minute.
    if (!(await env.RUN_LIMIT.limit({ key: workspaceId })).success) return { ok: false, retryAfter: MINUTE_MS / 1000 };
  } catch (e) {
    console.error("RUN_LIMIT failed; allowing the run", (e as Error).message);
  }
  try {
    return await takeWindow(env.DB, workspaceId, "run", LIMITS.runsPerHour, HOUR_MS, now);
  } catch (e) {
    console.error("run quota (D1) failed; allowing the run", (e as Error).message);
    return { ok: true };
  }
}

/**
 * `ToolContext.rateLimit` backed by PROBE_LIMIT, keyed by hostname (TDD §11). Our own demo Worker (and the
 * dev allow-origin) isn't limited: every workspace's demo shares one hostname, and the limit exists to protect
 * other people's sites. Fails open, like the run quota.
 */
export function probeLimiter(env: Pick<Env, "PROBE_LIMIT" | "DEMO_BASE_URL">): (host: string) => Promise<boolean> {
  const exempt = new Set([env.DEMO_BASE_URL, devAllowOrigin(env)].flatMap((u) => (u && URL.canParse(u) ? [new URL(u).hostname] : [])));
  return async (host) => {
    if (exempt.has(host)) return true;
    try {
      return (await env.PROBE_LIMIT.limit({ key: host })).success;
    } catch (e) {
      console.error("PROBE_LIMIT failed; allowing the probe", (e as Error).message);
      return true;
    }
  };
}
