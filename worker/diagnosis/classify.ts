import { HIGH_LATENCY_TOTAL_MS, HIGH_LATENCY_TTFB_MS } from "../loop/budget";
import type { DnsRaw } from "../tools/dns";
import { isTlsError, type HttpRaw, type Sample } from "../tools/http";
import type { ToolName, ToolResult } from "../tools/types";
import { isSignificant, type Category, type CertRaw, type Confidence, type Findings, type Provider, type ProviderRaw } from "./categories";
import { fingerprint } from "./fingerprint";

type Ev<Raw> = { id: string; raw: Raw; summary: string };
type Evidence = {
  dns: Ev<DnsRaw> | null;
  http: Ev<HttpRaw> | null;
  cert: Ev<CertRaw> | null;
  status: Ev<ProviderRaw> | null;
};
type Match = { category: Category; confidence: Confidence; ids: string[]; cause: string };

const EDGE_STATUSES = new Set([520, 521, 522, 523, 524, 525, 526, 527, 530]);
const CERT_WARN_DAYS = 7;
const PROVIDER_NAMES: Record<Provider, string> = { cloudflare: "Cloudflare", github: "GitHub", aws: "AWS" };

const NEXT_STEPS: Record<Category, string[]> = {
  dns_failure: [
    "Check that the domain is registered and its nameservers are correct at the registrar.",
    "Check that the zone has A or AAAA records for this hostname.",
  ],
  dns_mismatch: [
    "Compare the records at each authoritative nameserver; a recent change may still be propagating.",
    "Check for a DNSSEC or delegation problem that one resolver rejects.",
  ],
  tls_expiry: [
    "Renew the certificate or check that automatic renewal is working.",
    "Make sure the origin serves the full certificate chain for this hostname.",
  ],
  origin_5xx: [
    "Check the origin's application logs and recent deploys around the time errors started.",
    "Roll back the last change if the errors began after a deploy.",
  ],
  edge_error: [
    "Check that the origin server is up and reachable from Cloudflare.",
    "Check the origin's firewall, TLS mode and timeouts for the edge error code shown.",
  ],
  high_latency: [
    "Look for slow database queries or upstream calls in the origin.",
    "Check whether responses are cached at the edge and whether load has spiked.",
  ],
  redirect_loop: [
    "Check redirect rules on the origin and at the edge for rules that undo each other.",
    "Check the SSL mode: an HTTPS redirect at the origin behind a flexible edge mode loops.",
  ],
  cache_misconfiguration: [
    "Serve static assets with a public, long-lived cache-control header.",
    "Stop setting cookies on static asset responses.",
  ],
  provider_outage: [
    "Follow the provider's status page and wait for their fix.",
    "Fail over to another region or provider if you have one.",
  ],
  healthy: [
    "If users still report problems, ask for the exact URL, region and time.",
    "Add the endpoint to the watchlist to catch intermittent failures.",
  ],
  inconclusive: [
    "Run the checks again, or probe the specific path that users report as broken.",
    "Check the origin's logs for the requests made by these probes.",
  ],
};

/** Rule-based classification (TDD §9.3): first match wins. Pure, so the Workflow can call it inside a step. */
export function classify(results: ToolResult[]): Findings {
  const e = pick(results);
  const m = RULES.reduce<Match | null>((found, rule) => found ?? rule(e), null) ?? inconclusive(e);
  return {
    category: m.category,
    confidence: m.confidence,
    evidence: m.ids,
    cause: m.cause,
    next_steps: NEXT_STEPS[m.category],
    actions: m.category === "healthy" ? [] : ["restore_demo_service"],
  };
}

/** The latest result per tool that holds evidence about the target; refusals and outages are skipped. */
function pick(results: ToolResult[]): Evidence {
  const latest = <Raw>(tool: ToolName, usable: (r: ToolResult) => boolean): Ev<Raw> | null => {
    const r = results.filter((x) => x.tool === tool && usable(x)).at(-1);
    return r ? { id: r.evidenceId, raw: r.raw as Raw, summary: r.summary } : null;
  };
  return {
    dns: latest<DnsRaw>("dns_lookup", (r) => r.ok),
    http: latest<HttpRaw>("http_probe", (r) => (r.raw as HttpRaw).samples.length > 0),
    cert: latest<CertRaw>("cert_info", (r) => r.ok),
    status: latest<ProviderRaw>("provider_status", (r) => r.ok),
  };
}

const RULES: ((e: Evidence) => Match | null)[] = [
  dnsFailure,
  tlsExpiry,
  redirectLoop,
  edgeError,
  providerOutage,
  origin5xx,
  highLatency,
  cacheMisconfiguration,
  dnsMismatch,
  healthy,
];

function dnsFailure({ dns, http }: Evidence): Match | null {
  if (dns) {
    const per = Object.values(dns.raw.resolvers).map((types) => Object.values(types).filter((t) => t.status !== "ERROR"));
    if (per.some((answered) => answered.length === 0)) return null;
    const failed = per.map((answered) => answered.find((t) => t.status === "NXDOMAIN" || t.status === "SERVFAIL")?.status);
    if (failed.every(Boolean)) {
      return match("dns_failure", "high", [dns.id], `Both DNS resolvers return ${[...new Set(failed)].join("/")} for ${dns.raw.hostname}`);
    }
    const wantsAddresses = dns.raw.types.some((t) => t === "A" || t === "AAAA");
    if (wantsAddresses && Object.values(dns.raw.addresses).every((a) => a.length === 0)) {
      return match("dns_failure", "high", [dns.id], `Neither DNS resolver returns an A or AAAA record for ${dns.raw.hostname}`);
    }
    return null;
  }
  // No DNS check, but the probe's own SSRF lookup found no address.
  if (http?.raw.refused?.code === "no_addresses") {
    return match("dns_failure", "high", [http.id], `${host(http.raw)} has no A or AAAA records, so it couldn't be probed`);
  }
  return null;
}

function tlsExpiry({ http, cert }: Evidence): Match | null {
  const tls = http?.raw.samples.filter(isTlsError) ?? [];
  if (http && tls.length) {
    return match("tls_expiry", "high", [http.id], `The TLS handshake with ${host(http.raw)} fails on ${tls.length}/${http.raw.samples.length} samples`);
  }
  if (!cert) return null;
  const certs = cert.raw.certs.filter((c) => c.sanMatch);
  // WP-21: CT logs list issued certificates, not the one being served, so they only back up a failing site.
  const healthy = !!http && allOk(http.raw.samples);
  if (certs.length === 0) {
    // workerd hides the TLS reason, so a site that refuses every connection while no unexpired certificate
    // covers it in the CT logs is the best signal of an expired or missing certificate.
    if (!http || !http.raw.url.startsWith("https:")) return null;
    if (http.raw.samples.length === 0 || !http.raw.samples.every((s) => s.stop === "error")) return null;
    return match(
      "tls_expiry",
      "medium",
      [http.id, cert.id],
      `HTTPS connections to ${host(http.raw)} fail, and the CT logs show no unexpired certificate covering it`,
    );
  }
  const best = certs.reduce((a, b) => (b.daysToExpiry > a.daysToExpiry ? b : a));
  if (best.daysToExpiry < 0 && !healthy) {
    return match("tls_expiry", "high", [cert.id], `The newest certificate for ${cert.raw.hostname} expired ${-best.daysToExpiry} day(s) ago`);
  }
  if (http && healthy && best.daysToExpiry >= 0 && best.daysToExpiry <= CERT_WARN_DAYS) {
    return match(
      "tls_expiry",
      "medium",
      [cert.id, http.id],
      `The site responds normally, but its newest certificate expires in ${best.daysToExpiry} day(s)`,
    );
  }
  return null;
}

function redirectLoop({ http }: Evidence): Match | null {
  const s0 = http?.raw.samples[0];
  if (!http || !s0 || (s0.stop !== "loop" && s0.stop !== "max_hops")) return null;
  const what = s0.stop === "loop" ? `loop back to a visited URL after ${s0.hops.length} hops` : `exceed the hop cap (${s0.hops.length} hops)`;
  return match("redirect_loop", "high", [http.id], `Redirects from ${http.raw.url} ${what}`);
}

function edgeError({ http }: Evidence): Match | null {
  if (!http || !/cloudflare/i.test(http.raw.headers.server ?? "")) return null;
  const edge = statuses(http.raw.samples).filter((s) => EDGE_STATUSES.has(s));
  if (edge.length < 2) return null;
  return match(
    "edge_error",
    "high",
    [http.id],
    `Cloudflare's edge returns HTTP ${[...new Set(edge)].join("/")} on ${edge.length}/${http.raw.samples.length} samples, so it can't get a good response from the origin`,
  );
}

function providerOutage({ http, dns, status }: Evidence): Match | null {
  if (!http || !status) return null;
  const failing = http.raw.samples.some((s) => s.stop === "error" || (s.status ?? 0) >= 500);
  if (!failing) return null;
  for (const { provider, via } of fingerprint(http.raw.headers, dns?.raw.cnameChain ?? [])) {
    const active = (status.raw.providers[provider]?.active ?? []).filter(isSignificant);
    if (active.length === 0) continue;
    const ids = [http.id, status.id, ...(via === "dns" && dns ? [dns.id] : [])];
    const name = active[0]!.name.replace(/\s+/g, " ").slice(0, 80);
    return match("provider_outage", "medium", ids, `Requests are failing and ${PROVIDER_NAMES[provider]} reports an active incident ("${name}")`);
  }
  return null;
}

function origin5xx({ http }: Evidence): Match | null {
  if (!http) return null;
  const n = http.raw.samples.length;
  const bad = statuses(http.raw.samples).filter((s) => s >= 500);
  if (bad.length < 2) return null;
  const confidence = bad.length === n && n >= 3 ? "high" : "medium";
  return match("origin_5xx", confidence, [http.id], `The origin returns HTTP ${[...new Set(bad)].join("/")} on ${bad.length}/${n} samples`);
}

function highLatency({ http }: Evidence): Match | null {
  if (!http) return null;
  const { medianTotalMs: total, medianTtfbMs: ttfb } = http.raw;
  if ((total ?? 0) < HIGH_LATENCY_TOTAL_MS && (ttfb ?? 0) < HIGH_LATENCY_TTFB_MS) return null;
  return match("high_latency", "high", [http.id], `Responses are slow: median ${total} ms in total, ${ttfb} ms to first byte`);
}

function cacheMisconfiguration({ http }: Evidence): Match | null {
  const asset = http?.raw.asset;
  if (!http || !asset || !("status" in asset)) return null;
  const header = /\b(no-store|private)\b/i.exec(asset.cacheControl ?? "")?.[1]?.toLowerCase();
  if (!header && !asset.setCookie) return null;
  const problems = [header && `cache-control ${header}`, asset.setCookie && "a set-cookie header"].filter(Boolean).join(" and ");
  return match("cache_misconfiguration", "high", [http.id], `The static asset ${new URL(asset.url).pathname} is served with ${problems}, so it can't be cached`);
}

function dnsMismatch({ dns }: Evidence): Match | null {
  if (!dns?.raw.mismatch) return null;
  return match("dns_mismatch", "medium", [dns.id], `Cloudflare and Google DNS give different answers for ${dns.raw.hostname}`);
}

function healthy({ http, dns }: Evidence): Match | null {
  if (!http || !allOk(http.raw.samples)) return null;
  const ids = [http.id, ...(dns ? [dns.id] : [])];
  const s = statuses(http.raw.samples);
  return match("healthy", "high", ids, `${host(http.raw)} answers HTTP ${[...new Set(s)].join("/")} on ${s.length}/${s.length} samples in ${http.raw.medianTotalMs} ms (median)`);
}

function inconclusive({ http, dns, cert, status }: Evidence): Match {
  const ids = [http, dns, cert, status].flatMap((x) => (x ? [x.id] : []));
  if (ids.length === 0) return { category: "inconclusive", confidence: "low", ids, cause: "No check returned usable evidence, so there's nothing to diagnose yet." };
  const lead = http ?? dns!;
  return match("inconclusive", "low", ids, `The checks don't match a known failure pattern; the main signal is: ${trimDot(lead.summary)}`);
}

function match(category: Category, confidence: Confidence, ids: string[], text: string): Match {
  return { category, confidence, ids, cause: `${text} ${ids.map((id) => `[${id}]`).join(" ")}.` };
}

const statuses = (samples: Sample[]) => samples.flatMap((s) => (s.status === null ? [] : [s.status]));
const allOk = (samples: Sample[]) => samples.length > 0 && samples.every((s) => s.status !== null && s.status >= 200 && s.status < 400);
const host = (http: HttpRaw) => new URL(http.url).hostname;
export const trimDot = (s: string) => s.trim().replace(/\.$/, "");
