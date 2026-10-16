import type { DemoMode } from "../../demo-service/src/modes";
import type { IncidentStatus, Origin } from "../../worker/agent/state";
import type { WatchView } from "../../worker/watch/types";

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

/** Shown inline for a 429 (TDD §11: per workspace 3 runs a minute and 10 an hour; per visitor IP 6 and 20). */
export const rateLimitedText = (retryAfter: number) => `Run limit reached. Try again in ${retryText(retryAfter)}.`;

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

/** Also creates the workspace cookie on a first visit; use `firstSession` for that first call. */
export async function getSession(f: Fetch = fetch): Promise<Session | null> {
  try {
    const res = await f("/api/session");
    return res.ok ? ((await res.json()) as Session) : null;
  } catch {
    return null;
  }
}

/**
 * The first visit's session call, made once per page load (StrictMode runs effects twice). Each request
 * without a cookie creates its own workspace, so the app waits for this one before making any other call.
 */
export function sessionOnce(f: Fetch = fetch): () => Promise<Session | null> {
  let pending: Promise<Session | null> | null = null;
  return () => (pending ??= getSession(f));
}
export const firstSession = sessionOnce();

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

export type Watch = WatchView;
export type WatchError = "invalid_url" | "already_watched" | "watch_limit" | "watch_capacity" | "demo_unavailable" | "network" | "server";

export const WATCH_ERROR_TEXT: Record<WatchError, string> = {
  invalid_url: "Give a URL or a hostname, like api.example.com.",
  already_watched: "That URL is already on your watchlist.",
  watch_limit: "Your watchlist is full (3 at most). Remove one first.",
  watch_capacity: "The app is watching as many sites as it can (30). Try again later.",
  demo_unavailable: ERROR_TEXT.demo_unavailable,
  network: ERROR_TEXT.network,
  server: ERROR_TEXT.server,
};

/** The workspace's watches, or null if they couldn't be loaded. */
export async function listWatches(f: Fetch = fetch): Promise<Watch[] | null> {
  try {
    const res = await f("/api/watches");
    return res.ok ? ((await res.json()) as Watch[]) : null;
  } catch {
    return null;
  }
}

/** `message` is the server's reason for a refused URL (an IP literal, a private host, …). */
export async function addWatch(url: string, f: Fetch = fetch): Promise<{ ok: true; watch: Watch } | { ok: false; error: WatchError; message?: string }> {
  let res: Response;
  try {
    res = await f("/api/watches", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
  } catch {
    return { ok: false, error: "network" };
  }
  if (res.ok) return { ok: true, watch: (await res.json()) as Watch };
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  const error = (Object.keys(WATCH_ERROR_TEXT) as WatchError[]).find((k) => k === body.error) ?? "server";
  return { ok: false, error, ...(typeof body.message === "string" ? { message: body.message } : {}) };
}

export async function deleteWatch(id: string, f: Fetch = fetch): Promise<boolean> {
  try {
    return (await f(`/api/watches/${id}`, { method: "DELETE" })).ok;
  } catch {
    return false;
  }
}

export type WebhookInfo = { kind: "slack" | "discord"; hint: string };
export type WebhookState = { available: boolean; webhook: WebhookInfo | null };
export type WebhookError = "invalid_webhook" | "webhooks_unavailable" | "rate_limited" | "send_failed" | "network" | "server";

export const WEBHOOK_ERROR_TEXT: Record<WebhookError, string> = {
  invalid_webhook: "Use a Slack (hooks.slack.com) or Discord (discord.com/api/webhooks/…) webhook URL.",
  webhooks_unavailable: "Webhooks aren't set up on this deployment.",
  rate_limited: "That's enough tests for now (5 an hour). Try again later.",
  send_failed: "The test didn't go through. Check the webhook still exists in Slack or Discord.",
  network: ERROR_TEXT.network,
  server: ERROR_TEXT.server,
};

type WebhookResult<T> = { ok: true; value: T } | { ok: false; error: WebhookError; message?: string };

async function webhookCall<T>(f: Fetch, path: string, init: RequestInit | undefined, parse: (res: Response) => Promise<T>): Promise<WebhookResult<T>> {
  let res: Response;
  try {
    res = await f(`/api/webhook${path}`, init);
  } catch {
    return { ok: false, error: "network" };
  }
  if (res.ok) return { ok: true, value: await parse(res) };
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  const error = (Object.keys(WEBHOOK_ERROR_TEXT) as WebhookError[]).find((k) => k === body.error) ?? "server";
  return { ok: false, error, ...(typeof body.message === "string" ? { message: body.message } : {}) };
}

export const getWebhook = (f: Fetch = fetch) => webhookCall(f, "", undefined, async (r) => (await r.json()) as WebhookState);
export const saveWebhook = (url: string, f: Fetch = fetch) =>
  webhookCall(f, "", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) }, async (r) => (await r.json()) as WebhookInfo);
export const removeWebhook = (f: Fetch = fetch) => webhookCall(f, "", { method: "DELETE" }, async () => null);
export const testWebhook = (f: Fetch = fetch) => webhookCall(f, "/test", { method: "POST" }, async () => null);

/** Tells the DemoPanel to reload its modes, e.g. after an approved restore (WP-12). */
export const DEMO_CHANGED = "demo:changed";

/** Tells the sidebar to reload after something changed (creation, a status change). Polling is WP-19. */
export const INCIDENTS_CHANGED = "incidents:changed";
export const notifyIncidentsChanged = () => window.dispatchEvent(new Event(INCIDENTS_CHANGED));

/** `POST /api/voice` failures the UI explains (WP-23). */
export type VoiceError = "too_large" | "empty_audio" | "unsupported_type" | "voice_unavailable" | "transcribe_failed" | "rate_limited" | "network" | "server";

export const VOICE_ERROR_TEXT: Record<Exclude<VoiceError, "rate_limited">, string> = {
  too_large: "That recording is too long. Keep it under 30 seconds.",
  empty_audio: "Nothing was recorded. Try again.",
  unsupported_type: "This browser recorded audio the server can't read.",
  voice_unavailable: "Voice is off for today: the AI budget is used up. Type your question instead.",
  transcribe_failed: "Couldn't turn that into text. Try again, or type it.",
  network: "Couldn't reach the server. Check your connection and try again.",
  server: "Something went wrong on our side. Try again.",
};

export type TranscribeResult = { ok: true; text: string } | { ok: false; error: "rate_limited"; retryAfter: number } | { ok: false; error: Exclude<VoiceError, "rate_limited"> };

/** Sends one recording for transcription. The text only ever goes into the input box (FR-61). */
export async function transcribe(audio: Blob, f: Fetch = fetch): Promise<TranscribeResult> {
  let res: Response;
  try {
    res = await f("/api/voice", { method: "POST", headers: { "content-type": audio.type || "audio/webm" }, body: audio });
  } catch {
    return { ok: false, error: "network" };
  }
  const body = (await res.json().catch(() => ({}))) as { text?: unknown; error?: string; retryAfter?: unknown };
  if (res.ok && typeof body.text === "string") return { ok: true, text: body.text };
  if (res.status === 429) {
    const seconds = typeof body.retryAfter === "number" ? body.retryAfter : Number(res.headers.get("Retry-After"));
    return { ok: false, error: "rate_limited", retryAfter: Number.isFinite(seconds) && seconds > 0 ? seconds : 60 };
  }
  const known = Object.keys(VOICE_ERROR_TEXT) as Exclude<VoiceError, "rate_limited">[];
  return { ok: false, error: known.find((k) => k === body.error) ?? "server" };
}
