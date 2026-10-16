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
export async function takeWindow(db: D1Database, workspaceId: string, kind: "run" | "voice" | "webhook_test", limit: number, windowMs: number, now: number): Promise<Quota> {
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

/** Who is asking: the workspace, and the visitor's IP as an `ipKey` (null when the request carries none). */
export type Caller = { workspaceId: string; ip: string | null };

/**
 * The D1 and rate-limit key for a visitor IP: `ip:` plus a SHA-256 prefix, so raw addresses aren't stored.
 * Null without an address (local tools and tests that don't send `CF-Connecting-IP`; Cloudflare always sets it).
 */
export async function ipKey(ip: string | null | undefined): Promise<string | null> {
  if (!ip) return null;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip)));
  return `ip:${[...digest.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** One Rate Limiting binding call; an error is logged and allows the run (fail open). */
async function burst(binding: RateLimit, key: string, name: string): Promise<boolean> {
  try {
    return (await binding.limit({ key })).success;
  } catch (e) {
    console.error(`${name} failed; allowing the run`, (e as Error).message);
    return true;
  }
}

/** One D1 window; an error is logged and allows the call (fail open). */
async function hourly(db: D1Database, key: string, limit: number, now: number, kind: "run" | "voice" = "run"): Promise<Quota> {
  try {
    return await takeWindow(db, key, kind, limit, HOUR_MS, now);
  } catch (e) {
    console.error(`${kind} quota (D1) failed; allowing it`, (e as Error).message);
    return { ok: true };
  }
}

/**
 * The single "LLM run" quota (D14): new incidents and follow-ups. Per workspace, 3 a minute (RUN_LIMIT) and
 * 10 an hour (D1). Per visitor IP as well, 6 a minute (RUN_IP_LIMIT) and 20 an hour (D1, keyed by `ipKey`),
 * because a client that drops the cookie gets a new workspace each time. Fails open: a binding or D1 error
 * is logged and the run goes ahead, since the budget guard and the Workers AI allocation still protect neurons.
 */
export async function takeRun(env: Pick<Env, "RUN_LIMIT" | "RUN_IP_LIMIT" | "DB">, caller: Caller, now: number = Date.now()): Promise<Quota> {
  // The binding doesn't say when its window resets, so the burst answer is the worst case: a minute.
  const minute: Quota = { ok: false, retryAfter: MINUTE_MS / 1000 };
  if (!(await burst(env.RUN_LIMIT, caller.workspaceId, "RUN_LIMIT"))) return minute;
  if (caller.ip && !(await burst(env.RUN_IP_LIMIT, caller.ip, "RUN_IP_LIMIT"))) return minute;
  const ws = await hourly(env.DB, caller.workspaceId, LIMITS.runsPerHour, now);
  if (!ws.ok) return ws;
  return caller.ip ? hourly(env.DB, caller.ip, LIMITS.runsPerHourPerIp, now) : ws;
}

/**
 * The voice quota (WP-23, TDD §5.2): 5 transcriptions a minute (VOICE_LIMIT) and 20 an hour (D1, kind `voice`),
 * per workspace and per visitor IP, so dropping the cookie doesn't skip it. Fails open, like `takeRun`.
 */
export async function takeVoice(env: Pick<Env, "VOICE_LIMIT" | "DB">, caller: Caller, now: number = Date.now()): Promise<Quota> {
  const minute: Quota = { ok: false, retryAfter: MINUTE_MS / 1000 };
  for (const key of [caller.workspaceId, caller.ip]) {
    if (key && !(await burst(env.VOICE_LIMIT, key, "VOICE_LIMIT"))) return minute;
  }
  for (const key of [caller.workspaceId, caller.ip]) {
    if (!key) continue;
    const q = await hourly(env.DB, key, LIMITS.voicePerHour, now, "voice");
    if (!q.ok) return q;
  }
  return { ok: true };
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
