/** Failure categories (PRD §6.4, TDD §6.3). */
export const CATEGORIES = [
  "dns_failure",
  "dns_mismatch",
  "tls_expiry",
  "origin_5xx",
  "edge_error",
  "high_latency",
  "redirect_loop",
  "cache_misconfiguration",
  "provider_outage",
  "healthy",
  "inconclusive",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CONFIDENCES = ["high", "medium", "low"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

/** One-line definitions; the planning prompt lists these (TDD §9.1). */
export const CATEGORY_INFO: Record<Category, string> = {
  dns_failure: "The name doesn't resolve: NXDOMAIN/SERVFAIL from both resolvers, or no A/AAAA records.",
  dns_mismatch: "The resolvers disagree on the response code or on whether the name has any address.",
  tls_expiry: "The TLS handshake fails or the certificate has expired (or expires within 7 days).",
  origin_5xx: "The origin returns 5xx on most samples.",
  edge_error: "Cloudflare's edge returns 520–527 or 530: it can't reach or talk to the origin.",
  high_latency: "Responses succeed but are slow (median total ≥ 2000 ms or TTFB ≥ 1500 ms).",
  redirect_loop: "Redirects loop back to a visited URL or exceed the hop cap.",
  cache_misconfiguration: "Static assets are sent with no-store/private or set cookies, so they can't be cached.",
  provider_outage: "Requests fail and the hosting provider has an active incident.",
  healthy: "Every sample succeeds (2xx/3xx) and nothing above applies.",
  inconclusive: "The evidence doesn't fit any category (timeouts with good DNS, 4xx, missing checks).",
};

/** Action catalog IDs (TDD §7.6); WP-12's `actions/catalog.ts` decides which are proposable. */
export const ACTION_IDS = ["restore_demo_service", "add_to_watchlist", "recheck_burst", "generate_postmortem"] as const;
export type ActionId = (typeof ACTION_IDS)[number];

/** What each action does and when it can be proposed (TDD §7.6); listed in the planning prompt. */
export const ACTION_INFO: Record<ActionId, string> = {
  restore_demo_service: "Switch the demo service back to healthy mode. Only for the demo target, and only when it isn't healthy.",
  add_to_watchlist: "Re-check the endpoint every 5 minutes for 24 hours. Only if it isn't already watched.",
  recheck_burst: "Re-check every minute for 15 minutes. Only when no monitor is running.",
  generate_postmortem: "Write a postmortem. Only once the incident is resolved.",
};

/** The structured diagnosis: the `submit_findings` tool's shape (D5, TDD §7.3), also produced by `classify`. */
export type Findings = {
  category: Category;
  confidence: Confidence;
  evidence: string[];
  cause: string;
  next_steps: string[];
  actions: ActionId[];
};

/** `cert_info` raw evidence (WP-21): certificates found in CT logs (crt.sh), best effort. */
export type CertRaw = {
  hostname: string;
  /** Matching certificates first (most days left first), at most 3. */
  certs: { issuer: string; notBefore: string; notAfter: string; daysToExpiry: number; sanMatch: boolean }[];
  /** The crt.sh queries made: the host itself and `*.parent` for wildcard certificates. */
  queries?: string[];
  /** Queries crt.sh didn't answer; with any, the check is `unavailable`. */
  failed?: string[];
};

export const PROVIDERS = ["cloudflare", "github", "aws"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** One unresolved incident. Statuspage reports `impact` (none, minor, major, critical); AWS doesn't. */
export type ProviderIncident = { name: string; status?: string; impact?: string; url?: string };

/** `provider_status` raw evidence (WP-21). Providers that weren't checked are absent. */
export type ProviderRaw = {
  providers: Partial<Record<Provider, { active: ProviderIncident[] }>>;
  /** Providers whose status page didn't answer. */
  unavailable?: Provider[];
};

/**
 * Whether an incident counts as an outage (WP-21). Cloudflare almost always has a minor incident open (for example
 * dashboard sign-ups), so only major or critical ones count; incidents without an impact (AWS) always do.
 */
export function isSignificant(i: ProviderIncident): boolean {
  return i.impact === undefined || i.impact === "major" || i.impact === "critical";
}
