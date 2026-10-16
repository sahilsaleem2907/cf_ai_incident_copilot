import type { Fetch } from "../lib/doh";
import type { Guard, GuardFail } from "./ssrf";

/** Capped, timed, redirect-free reads (TDD §11 "Open proxy"). Every hop goes back through the guard. */
export const READ_CAP = 16 * 1024;
export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_HOPS = 5;
export const USER_AGENT = "IncidentCopilot/0.1 (+https://github.com/sahilsaleem2907/cf_ai_incident_copilot)";

export type Method = "GET" | "HEAD";

export type ReadOk = {
  ok: true;
  url: string;
  status: number;
  headers: Headers;
  location: string | null;
  body: string;
  truncated: boolean;
  ttfbMs: number;
  totalMs: number;
};
export type ReadErr = { ok: false; url: string; error: "timeout" | "network"; message: string; totalMs: number };
export type ReadResult = ReadOk | ReadErr;

type ReadOptions = {
  timeoutMs?: number;
  readCap?: number;
  now?: () => number;
  /** Turns the capped bytes into text; UTF-8 by default. AWS's health feed is UTF-16 (WP-21). */
  decode?: (bytes: Uint8Array) => string;
};

export async function readOnce(fetchFn: Fetch, url: string, method: Method = "GET", opts: ReadOptions = {}): Promise<ReadResult> {
  const now = opts.now ?? (() => Date.now());
  const start = now();
  try {
    const res = await fetchFn(url, {
      method,
      redirect: "manual",
      headers: { "user-agent": USER_AGENT, accept: "*/*" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? FETCH_TIMEOUT_MS),
    });
    const ttfbMs = now() - start;
    const { body, truncated } = await readCapped(res, opts.readCap ?? READ_CAP, opts.decode);
    return {
      ok: true,
      url,
      status: res.status,
      headers: res.headers,
      location: res.headers.get("location"),
      body,
      truncated,
      ttfbMs,
      totalMs: now() - start,
    };
  } catch (e) {
    const err = e as Error;
    // Running out of subrequest budget is not a property of the target; let the caller handle it.
    if (err.name === "BudgetExceededError") throw err;
    const timeout = err.name === "TimeoutError" || err.name === "AbortError";
    return { ok: false, url, error: timeout ? "timeout" : "network", message: err.message, totalMs: now() - start };
  }
}

async function readCapped(res: Response, cap: number, decode: (bytes: Uint8Array) => string = (b) => new TextDecoder().decode(b)): Promise<{ body: string; truncated: boolean }> {
  if (!res.body) return { body: "", truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = cap - size;
    if (value.byteLength > room) {
      chunks.push(value.subarray(0, room));
      size += room;
      truncated = true;
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  if (truncated) await reader.cancel().catch(() => undefined);
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return { body: decode(all), truncated };
}

export type Hop = { url: string; status: number; location: string | null; ttfbMs: number; totalMs: number };
export type HopStop = "done" | "loop" | "max_hops" | "blocked" | "error";
export type HopResult = {
  hops: Hop[];
  /** Last response read (the final page, or the last redirect when stopped early). */
  final: ReadOk | null;
  stop: HopStop;
  blocked?: GuardFail & { url: string };
  error?: ReadErr | { ok: false; url: string; error: "bad_location"; message: string };
};

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** Follows redirects by hand: at most 1 + MAX_HOPS requests, guard-checked each time, stopping on a loop. */
export async function followHops(fetchFn: Fetch, guard: Guard, startUrl: string, method: Method = "GET", opts: ReadOptions = {}): Promise<HopResult> {
  const hops: Hop[] = [];
  const seen = new Set<string>();
  let current = startUrl;
  let final: ReadOk | null = null;

  for (let i = 0; i <= MAX_HOPS; i++) {
    if (seen.has(current)) return { hops, final, stop: "loop" };
    seen.add(current);

    const checked = await guard(current);
    if (!checked.ok) return { hops, final, stop: "blocked", blocked: { ...checked, url: current } };

    const res = await readOnce(fetchFn, checked.url.toString(), method, opts);
    if (!res.ok) return { hops, final, stop: "error", error: res };
    final = res;
    hops.push({ url: res.url, status: res.status, location: res.location, ttfbMs: res.ttfbMs, totalMs: res.totalMs });

    if (!REDIRECTS.has(res.status) || !res.location) return { hops, final, stop: "done" };
    try {
      current = new URL(res.location, res.url).toString();
    } catch {
      return { hops, final, stop: "error", error: { ok: false, url: res.url, error: "bad_location", message: res.location } };
    }
  }
  return { hops, final, stop: "max_hops" };
}
