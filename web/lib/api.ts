import type { IncidentStatus, Origin } from "../../worker/agent/state";

/** Errors the UI explains in words (TDD §7.1). */
export type ApiError = "need_target" | "empty_message" | "demo_unavailable" | "rate_limited" | "network" | "server";

export const ERROR_TEXT: Record<ApiError, string> = {
  need_target: "Which site is broken? Include a URL or a hostname, like cloudflare.com, or say “demo”.",
  empty_message: "Type a message first.",
  demo_unavailable: "The demo service isn't set up yet. Try a real hostname, like cloudflare.com.",
  rate_limited: "Too many requests. Wait a minute and try again.",
  network: "Couldn't reach the server. Check your connection and try again.",
  server: "Something went wrong on our side. Try again.",
};

export type IncidentRow = { id: string; target: string; status: IncidentStatus; origin: Origin; unread: boolean; updatedAt: number };
export type Session = { demoUrl: string; budgetMode: "ai" | "rule_based" };

type Fetch = typeof fetch;

export async function createIncident(message: string, f: Fetch = fetch): Promise<{ ok: true; id: string } | { ok: false; error: ApiError }> {
  let res: Response;
  try {
    res = await f("/api/incidents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }) });
  } catch {
    return { ok: false, error: "network" };
  }
  if (res.ok) return { ok: true, id: ((await res.json()) as { id: string }).id };
  if (res.status === 429) return { ok: false, error: "rate_limited" };
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  const known: ApiError[] = ["need_target", "empty_message", "demo_unavailable"];
  return { ok: false, error: known.includes(body.error as ApiError) ? (body.error as ApiError) : "server" };
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

/** Tells the sidebar to reload after something changed (creation, a status change). Polling is WP-19. */
export const INCIDENTS_CHANGED = "incidents:changed";
export const notifyIncidentsChanged = () => window.dispatchEvent(new Event(INCIDENTS_CHANGED));
