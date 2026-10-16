import type { Provider } from "../diagnosis/categories";
import { fingerprint } from "../diagnosis/fingerprint";
import type { HttpRaw } from "../tools/http";
import type { ToolName } from "../tools/types";

/** What the automatic checks need from an `http_probe`, worked out inside its step so a replay sees the same. */
export type HttpSignals = { https: boolean; connectFailed: boolean; failing: boolean; providers: Provider[] };

export function httpSignals(raw: Partial<HttpRaw>): HttpSignals {
  const samples = raw.samples ?? [];
  return {
    https: typeof raw.url === "string" && raw.url.startsWith("https:"),
    // A network error with no response: on workerd that's how an expired or self-signed certificate looks.
    connectFailed: samples.some((s) => s.stop === "error" && s.error === "network"),
    failing: samples.some((s) => s.stop === "error" || (s.status ?? 0) >= 500),
    providers: fingerprint(raw.headers ?? {}, []).map((f) => f.provider),
  };
}

/**
 * The checks worth running on their own, after the baseline (WP-21, user decision "only when useful"):
 * `cert_info` when HTTPS requests fail to connect, and `provider_status` when the site is failing and looks hosted
 * on a provider we can check. Never for the user's own demo: its 500s are ours, not Cloudflare's.
 */
export function extraCalls(p: {
  host: string;
  signals: HttpSignals | null;
  cnames: readonly string[];
  ran: ReadonlySet<ToolName>;
  isDemo: boolean;
}): { tool: ToolName; args: unknown }[] {
  const s = p.signals;
  if (!s) return [];
  const calls: { tool: ToolName; args: unknown }[] = [];
  if (s.https && s.connectFailed && !p.ran.has("cert_info")) calls.push({ tool: "cert_info", args: { hostname: p.host } });
  const providers = [...new Set([...s.providers, ...fingerprint({}, p.cnames).map((f) => f.provider)])];
  if (s.failing && !p.isDemo && providers.length && !p.ran.has("provider_status")) calls.push({ tool: "provider_status", args: { providers } });
  return calls;
}
