import type { DemoMode } from "../../demo-service/src/modes";
import type { IncidentStatus, Origin } from "../../worker/agent/state";

/** Errors the UI explains in words (TDD §7.1). */
export type ApiError = "need_target" | "empty_message" | "demo_unavailable" | "rate_limited" | "network" | "server";

export const ERROR_TEXT: Record<ApiError, string> = {
  need_target: "Which site is broken? Include a URL or a hostname, like cloudflare.com, or say “demo”.",
  empty_message: "Type a message first.",
  demo_unavailable: "The demo service isn't set up yet. Try a real hostname, like cloudflare.com.",
  rate_limited: "Run limit reached. Wait a minute and try again.",
  network: "Couldn't reach the server. Check your connection and try again.",
  server: "Something went wrong on our side. Try again.",
};

/** "about a minute" up to 90 s, then whole minutes rounded up. */
export function retryText(seconds: number): string {
  if (seconds <= 90) return "about a minute";
  return `${Math.ceil(seconds / 60)} minutes`;
}

/** Shown in the toast and inline for a 429 (TDD §11: 3 runs a minute, 10 an hour per workspace). */
export const rateLimitedText = (retryAfter: number) => `Run limit reached (3 a minute, 10 an hour). Try again in ${retryText(retryAfter)}.`;

/** The agent's `sendMessage` refuses with `rate_limited:<seconds>`; returns the seconds, or null for other errors. */
export function parseRateLimited(message: string): number | null {
  const m = /rate_limited:(\d+)/.exec(message);
  return m ? Number(m[1]) : null;
}

export type IncidentRow = { id: string; target: string; status: IncidentStatus; origin: Origin; unread: boolean; updatedAt: number };
export type Session = { demoUrl: string; budgetMode: "ai" | "rule_based" };

type Fetch = typeof fetch;

export type CreateResult = { ok: true; id: string } | { ok: false; error: "rate_limited"; retryAfter: number } | { ok: false; error: Exclude<ApiError, "rate_limited"> };

export async function createIncident(message: string, f: Fetch = fetch): Promise<CreateResult> {
  let res: Response;
  try {
    res = await f("/api/incidents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }) });
  } catch {
    return { ok: false, error: "network" };
  }
  if (res.ok) return { ok: true, id: ((await res.json()) as { id: string }).id };
  const body = (await res.json().catch(() => ({}))) as { error?: string; retryAfter?: unknown };
  if (res.status === 429) {
    const seconds = typeof body.retryAfter === "number" ? body.retryAfter : Number(res.headers.get("Retry-After"));
    return { ok: false, error: "rate_limited", retryAfter: Number.isFinite(seconds) && seconds > 0 ? seconds : 60 };
  }
  const known = ["need_target", "empty_message", "demo_unavailable"] as const;
  const error = known.find((k) => k === body.error);
  return { ok: false, error: error ?? "server" };
}

export async function listIncidents(f: Fetch = fetch): Promise<IncidentRow[]> {
  try {
    const res = await f("/api/incidents");
    return res.ok ? ((await res.json()) as IncidentRow[]) : [];
  } catch {
    return [];
  }
}

/** Also creates the workspace cookie on a first visit. */
export async function getSession(f: Fetch = fetch): Promise<Session | null> {
  try {
    const res = await f("/api/session");
    return res.ok ? ((await res.json()) as Session) : null;
  } catch {
    return null;
  }
}

export type Demo = { modes: DemoMode[]; url: string };
export type DemoResult = { ok: true; demo: Demo } | { ok: false; error: "demo_unavailable" | "network" | "server" };

async function demoCall(f: Fetch, init?: RequestInit): Promise<DemoResult> {
  let res: Response;
  try {
    res = await f(init ? "/api/demo/mode" : "/api/demo", init);
  } catch {
    return { ok: false, error: "network" };
  }
  if (res.ok) return { ok: true, demo: (await res.json()) as Demo };
  return { ok: false, error: res.status === 503 ? "demo_unavailable" : "server" };
}

export const getDemo = (f: Fetch = fetch) => demoCall(f);

export const setDemoModes = (modes: DemoMode[], f: Fetch = fetch) =>
  demoCall(f, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ modes }) });

/** Tells the DemoPanel to reload its modes, e.g. after an approved restore (WP-12). */
export const DEMO_CHANGED = "demo:changed";

/** Tells the sidebar to reload after something changed (creation, a status change). Polling is WP-19. */
export const INCIDENTS_CHANGED = "incidents:changed";
export const notifyIncidentsChanged = () => window.dispatchEvent(new Event(INCIDENTS_CHANGED));
