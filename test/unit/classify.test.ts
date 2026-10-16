import { describe, expect, it } from "vitest";
import { CATEGORIES, type CertRaw, type Provider, type ProviderRaw } from "../../worker/diagnosis/categories";
import { classify } from "../../worker/diagnosis/classify";
import type { DnsRaw, TypeResult } from "../../worker/tools/dns";
import type { HttpRaw, Sample } from "../../worker/tools/http";
import type { CheckStatus, ToolResult } from "../../worker/tools/types";

// Builders: healthy by default, each option breaks one thing.

type DnsOpts = { id?: string; rcode?: [string, string]; addresses?: [string[], string[]]; cname?: string[]; mismatch?: boolean; addressesDiffer?: boolean };

function dns(o: DnsOpts = {}): ToolResult<DnsRaw> {
  const [cfCode, gCode] = o.rcode ?? ["NOERROR", "NOERROR"];
  const [cfAddrs, gAddrs] = o.addresses ?? [["93.184.215.14"], ["93.184.215.14"]];
  const typeResult = (code: string, addrs: string[]): TypeResult =>
    code === "ERROR" ? { status: "ERROR", error: "resolver down", answers: [] } : { status: code, answers: addrs.map((data) => ({ type: "A", data, ttl: 300 })) };
  const answered = [cfCode, gCode].some((c) => c !== "ERROR");
  const status: CheckStatus = !answered ? "unavailable" : o.mismatch || cfCode !== "NOERROR" ? "fail" : "pass";
  return {
    evidenceId: o.id ?? "dns-1",
    tool: "dns_lookup",
    ok: status !== "unavailable",
    status,
    summary: "dns summary",
    digest: "{}",
    raw: {
      hostname: "shop.example.com",
      types: ["A"],
      resolvers: { cloudflare: { A: typeResult(cfCode, cfAddrs) }, google: { A: typeResult(gCode, gAddrs) } },
      addresses: { cloudflare: cfCode === "NOERROR" ? cfAddrs : [], google: gCode === "NOERROR" ? gAddrs : [] },
      cnameChain: o.cname ?? [],
      cnameTargets: o.cname ?? [],
      mismatch: o.mismatch ?? false,
      addressesDiffer: o.addressesDiffer ?? false,
      ssrfBlocked: false,
    },
  };
}

type HttpOpts = {
  id?: string;
  /** One entry per sample; null = the request failed (see `error`). */
  statuses?: (number | null)[];
  error?: "timeout" | "network";
  message?: string;
  stop?: "loop" | "max_hops";
  totalMs?: number;
  ttfbMs?: number;
  server?: string;
  cfRay?: string;
  asset?: HttpRaw["asset"];
  refused?: HttpRaw["refused"];
  summary?: string;
};

function http(o: HttpOpts = {}): ToolResult<HttpRaw> {
  const url = "https://shop.example.com/";
  const total = o.totalMs ?? 120;
  const ttfb = o.ttfbMs ?? 80;
  let samples: Sample[];
  if (o.stop) {
    const hops = [
      { url, status: 302, location: "/r" },
      { url: `${url}r`, status: 302, location: "/" },
    ];
    samples = [{ status: 302, ttfbMs: ttfb, totalMs: total, stop: o.stop, hops }];
  } else if (o.refused) {
    samples = [{ status: null, ttfbMs: null, totalMs: 0, stop: "blocked", error: o.refused.code, hops: [] }];
  } else {
    samples = (o.statuses ?? [200, 200, 200]).map((status) =>
      status === null
        ? { status, ttfbMs: null, totalMs: total, stop: "error", error: o.error ?? "timeout", ...(o.message ? { message: o.message } : {}), hops: [] }
        : { status, ttfbMs: ttfb, totalMs: total, stop: "done", hops: [{ url, status, location: null }] },
    );
  }
  const responded = samples.filter((s) => s.status !== null);
  const refusedHard = o.refused && o.refused.code !== "no_addresses";
  return {
    evidenceId: o.id ?? "http-1",
    tool: "http_probe",
    ok: !refusedHard,
    status: refusedHard ? "error" : "fail",
    summary: o.summary ?? "http summary.",
    digest: "{}",
    raw: {
      url,
      method: "GET",
      samples,
      medianTotalMs: responded.length ? total : null,
      medianTtfbMs: responded.length ? ttfb : null,
      hops: samples[0]?.hops ?? [],
      headers: { setCookie: false, ...(o.server ? { server: o.server } : {}), ...(o.cfRay ? { "cf-ray": o.cfRay } : {}) },
      snippet: null,
      asset: o.asset ?? null,
      ...(o.refused ? { refused: o.refused } : {}),
    },
  };
}

function cert(days: number, sanMatch = true): ToolResult<CertRaw> {
  return {
    evidenceId: "cert-1",
    tool: "cert_info",
    ok: true,
    status: days < 0 ? "fail" : "pass",
    summary: "cert summary",
    digest: "{}",
    raw: { hostname: "shop.example.com", certs: [{ issuer: "R3", notBefore: "2026-07-01", notAfter: "2026-10-01", daysToExpiry: days, sanMatch }] },
  };
}

function provider(active: Partial<Record<Provider, string[]>>): ToolResult<ProviderRaw> {
  const providers: ProviderRaw["providers"] = {};
  for (const [p, names] of Object.entries(active)) providers[p as Provider] = { active: names.map((name) => ({ name })) };
  return { evidenceId: "status-1", tool: "provider_status", ok: true, status: "pass", summary: "status summary", digest: "{}", raw: { providers } };
}

const goodAsset = { url: "https://shop.example.com/static/app.js", status: 200, cacheControl: "public, max-age=31536000, immutable", setCookie: false };

describe("classify: one fixture per category", () => {
  const cases: [string, ToolResult[], { category: string; confidence: string; evidence: string[] }][] = [
    ["dns_failure (NXDOMAIN)", [dns({ rcode: ["NXDOMAIN", "NXDOMAIN"], addresses: [[], []] }), http({ statuses: [null, null, null] })], { category: "dns_failure", confidence: "high", evidence: ["dns-1"] }],
    ["tls_expiry (expired cert, site refusing connections)", [dns(), http({ statuses: [null, null, null], error: "network" }), cert(-3)], { category: "tls_expiry", confidence: "high", evidence: ["cert-1"] }],
    ["redirect_loop", [dns(), http({ stop: "loop" })], { category: "redirect_loop", confidence: "high", evidence: ["http-1"] }],
    ["edge_error", [dns(), http({ statuses: [522, 522, 522], server: "cloudflare" })], { category: "edge_error", confidence: "high", evidence: ["http-1"] }],
    ["provider_outage", [dns(), http({ statuses: [500, 500, 500], server: "cloudflare" }), provider({ cloudflare: ["Elevated 5xx errors in LHR"] })], { category: "provider_outage", confidence: "medium", evidence: ["http-1", "status-1"] }],
    ["origin_5xx (demo errors)", [dns(), http({ statuses: [500, 500, 500] })], { category: "origin_5xx", confidence: "high", evidence: ["http-1"] }],
    ["high_latency (demo slow)", [dns(), http({ totalMs: 3100, ttfbMs: 3050, asset: goodAsset })], { category: "high_latency", confidence: "high", evidence: ["http-1"] }],
    ["cache_misconfiguration (demo bad_cache)", [dns(), http({ asset: { ...goodAsset, cacheControl: "no-store", setCookie: true } })], { category: "cache_misconfiguration", confidence: "high", evidence: ["http-1"] }],
    ["dns_mismatch", [dns({ rcode: ["NOERROR", "NXDOMAIN"], addresses: [["93.184.215.14"], []], mismatch: true }), http({ statuses: [404, 404, 404] })], { category: "dns_mismatch", confidence: "medium", evidence: ["dns-1"] }],
    ["healthy (demo healthy)", [dns(), http({ asset: goodAsset })], { category: "healthy", confidence: "high", evidence: ["http-1", "dns-1"] }],
    ["inconclusive (timeouts with good DNS)", [dns(), http({ statuses: [null, null, null], error: "timeout" })], { category: "inconclusive", confidence: "low", evidence: ["http-1", "dns-1"] }],
  ];

  it("covers every category", () => {
    expect(new Set(cases.map(([, , want]) => want.category))).toEqual(new Set(CATEGORIES));
  });

  it.each(cases)("%s", (_name, evidence, want) => {
    const f = classify(evidence);
    expect(f).toMatchObject(want);
    for (const id of want.evidence) expect(f.cause).toContain(`[${id}]`);
    expect(f.cause).toMatch(/\]\.$/);
    expect(f.next_steps.length).toBeGreaterThanOrEqual(2);
  });
});

describe("classify: precedence (first match wins)", () => {
  const cat = (evidence: ToolResult[]) => classify(evidence).category;

  it("dns_failure beats an HTTP failure", () => {
    expect(cat([dns({ rcode: ["SERVFAIL", "SERVFAIL"], addresses: [[], []] }), http({ statuses: [500, 500, 500] })])).toBe("dns_failure");
  });
  it("a TLS handshake error is tls_expiry, ahead of everything after it", () => {
    const f = classify([dns(), http({ statuses: [null, null, null], error: "network", message: "TLS peer's certificate is not trusted" })]);
    expect(f).toMatchObject({ category: "tls_expiry", confidence: "high", evidence: ["http-1"] });
  });
  it("redirect_loop beats 5xx", () => {
    expect(cat([dns(), http({ stop: "max_hops" })])).toBe("redirect_loop");
  });
  it("52x from Cloudflare is edge_error; the same codes without server: cloudflare are origin_5xx", () => {
    expect(cat([dns(), http({ statuses: [521, 521, 521], server: "cloudflare" })])).toBe("edge_error");
    expect(cat([dns(), http({ statuses: [521, 521, 521], server: "nginx" })])).toBe("origin_5xx");
  });
  it("edge_error needs two edge samples (one bad sample isn't healthy either)", () => {
    expect(cat([dns(), http({ statuses: [522, 200, 200], server: "cloudflare" })])).toBe("inconclusive");
  });
  it("provider incident + 5xx beats origin_5xx; no incident falls through", () => {
    expect(cat([dns(), http({ statuses: [503, 503, 503], cfRay: "abc-LHR" }), provider({ cloudflare: ["Outage"] })])).toBe("provider_outage");
    expect(cat([dns(), http({ statuses: [503, 503, 503], cfRay: "abc-LHR" }), provider({ cloudflare: [] })])).toBe("origin_5xx");
  });
  it("provider incident only counts for the fingerprinted provider", () => {
    expect(cat([dns(), http({ statuses: [500, 500, 500], server: "nginx" }), provider({ cloudflare: ["Outage"] })])).toBe("origin_5xx");
    const gh = classify([dns({ cname: ["user.github.io"] }), http({ statuses: [null, null, null] }), provider({ github: ["Pages degraded"] })]);
    expect(gh).toMatchObject({ category: "provider_outage", evidence: ["http-1", "status-1", "dns-1"] });
    expect(cat([dns({ cname: ["x.s3.amazonaws.com"] }), http({ statuses: [500, 500, 500] }), provider({ aws: ["S3 errors"] })])).toBe("provider_outage");
  });
  it("only major or critical Statuspage incidents count (Cloudflare nearly always has a minor one open)", () => {
    const withImpact = (impact: string) => {
      const p = provider({ cloudflare: ["Dashboard sign up issues"] });
      p.raw.providers.cloudflare!.active[0]!.impact = impact;
      return p;
    };
    expect(cat([dns(), http({ statuses: [500, 500, 500], server: "cloudflare" }), withImpact("minor")])).toBe("origin_5xx");
    expect(cat([dns(), http({ statuses: [500, 500, 500], server: "cloudflare" }), withImpact("major")])).toBe("provider_outage");
    expect(cat([dns(), http({ statuses: [500, 500, 500], server: "cloudflare" }), withImpact("critical")])).toBe("provider_outage");
    // AWS events older than a day are marked "ongoing" (provider.ts) and don't count either.
    const aws = provider({ aws: ["Region Availability (UAE)"] });
    aws.raw.providers.aws!.active[0]!.impact = "ongoing";
    expect(cat([dns({ cname: ["x.s3.amazonaws.com"] }), http({ statuses: [500, 500, 500] }), aws])).toBe("origin_5xx");
  });
  it("provider incident with healthy HTTP is still healthy", () => {
    expect(cat([dns(), http({ server: "cloudflare" }), provider({ cloudflare: ["Outage"] })])).toBe("healthy");
  });
  it("slow + bad cache is high_latency", () => {
    expect(cat([dns(), http({ totalMs: 2500, asset: { ...goodAsset, cacheControl: "private" } })])).toBe("high_latency");
  });
  it("TTFB alone can make it high_latency", () => {
    expect(cat([dns(), http({ totalMs: 1600, ttfbMs: 1500 })])).toBe("high_latency");
    expect(cat([dns(), http({ totalMs: 1999, ttfbMs: 1499 })])).toBe("healthy");
  });
  it("mismatch + 5xx is origin_5xx (mismatch is a late rule)", () => {
    expect(cat([dns({ rcode: ["NOERROR", "SERVFAIL"], addresses: [["1.2.3.4"], []], mismatch: true }), http({ statuses: [500, 500, 500] })])).toBe("origin_5xx");
  });
});

describe("classify: edge cases", () => {
  it("different address sets alone (geo/CDN DNS) are healthy, not dns_mismatch", () => {
    expect(classify([dns({ addresses: [["1.1.1.1"], ["2.2.2.2"]], addressesDiffer: true }), http()]).category).toBe("healthy");
  });
  it("a resolver outage isn't a DNS failure", () => {
    expect(classify([dns({ rcode: ["ERROR", "ERROR"], addresses: [[], []] }), http({ statuses: [null, null, null] })]).category).toBe("inconclusive");
  });
  it("NXDOMAIN from one resolver while the other is down isn't dns_failure", () => {
    expect(classify([dns({ rcode: ["NXDOMAIN", "ERROR"], addresses: [[], []] })]).category).not.toBe("dns_failure");
  });
  it("NOERROR with no addresses from both resolvers is dns_failure", () => {
    const f = classify([dns({ addresses: [[], []] })]);
    expect(f).toMatchObject({ category: "dns_failure", confidence: "high" });
    expect(f.cause).toContain("Neither DNS resolver returns an A or AAAA record");
  });
  it("without a DNS check, a probe refused for no_addresses is dns_failure", () => {
    const f = classify([http({ refused: { code: "no_addresses", message: "shop.example.com has no A/AAAA records" } })]);
    expect(f).toMatchObject({ category: "dns_failure", evidence: ["http-1"] });
  });
  it("a probe refused for a private address is inconclusive", () => {
    expect(classify([dns(), http({ refused: { code: "private_address", message: "resolves to 10.0.0.9" } })]).category).toBe("inconclusive");
  });
  it("an opaque connection error isn't a TLS failure", () => {
    expect(classify([dns(), http({ statuses: [null, null, null], error: "network", message: "internal error; reference = abc" })]).category).toBe("inconclusive");
  });
  it("a cert expiring within 7 days is tls_expiry medium only when HTTP is healthy", () => {
    expect(classify([dns(), http(), cert(5)])).toMatchObject({ category: "tls_expiry", confidence: "medium", evidence: ["cert-1", "http-1"] });
    expect(classify([dns(), http({ statuses: [500, 500, 500] }), cert(5)]).category).toBe("origin_5xx");
    expect(classify([dns(), http(), cert(30)]).category).toBe("healthy");
  });
  it("only certificates that match the hostname count", () => {
    expect(classify([dns(), http(), cert(-3, false)]).category).toBe("healthy");
  });
  it("an expired certificate in the CT logs doesn't override a healthy site (CT shows issued, not served, certs)", () => {
    expect(classify([dns(), http(), cert(-3)]).category).toBe("healthy");
  });
  it("HTTPS refusing every connection with no unexpired certificate in the CT logs is tls_expiry medium", () => {
    const none = { ...cert(30), status: "fail" as const, raw: { hostname: "shop.example.com", certs: [] } };
    const refused = http({ statuses: [null, null, null], error: "network", message: "internal error; reference = abc" });
    expect(classify([dns(), refused, none])).toMatchObject({ category: "tls_expiry", confidence: "medium", evidence: ["http-1", "cert-1"] });
    // Some samples answering means the connection works: not a certificate problem.
    expect(classify([dns(), http({ statuses: [null, 200, 200], error: "network" }), none]).category).not.toBe("tls_expiry");
    // A certificate that's valid in the CT logs leaves an opaque error inconclusive.
    expect(classify([dns(), refused, cert(30)]).category).toBe("inconclusive");
  });
  it("an unavailable certificate check is ignored", () => {
    const down = { ...cert(-3), ok: false, status: "unavailable" as const };
    expect(classify([dns(), http({ statuses: [null, null, null], error: "network" }), down]).category).toBe("inconclusive");
  });
  it("2 of 3 samples 5xx is origin_5xx with medium confidence; 1 of 3 is inconclusive", () => {
    expect(classify([dns(), http({ statuses: [500, 502, 200] })])).toMatchObject({ category: "origin_5xx", confidence: "medium" });
    expect(classify([dns(), http({ statuses: [500, 200, 200] })]).category).toBe("inconclusive");
  });
  it("4xx is inconclusive", () => {
    expect(classify([dns(), http({ statuses: [404, 404, 404], summary: "HTTP 404/404/404." })])).toMatchObject({ category: "inconclusive", confidence: "low" });
  });
  it("no evidence at all is inconclusive and cites nothing", () => {
    const f = classify([]);
    expect(f).toMatchObject({ category: "inconclusive", confidence: "low", evidence: [] });
    expect(f.cause).not.toContain("[");
  });
  it("missing cert and provider evidence never throws", () => {
    expect(() => classify([http({ statuses: [500, 500, 500], server: "cloudflare" })])).not.toThrow();
  });
  it("uses the latest HTTP result", () => {
    const f = classify([dns(), http({ id: "http-1", statuses: [500, 500, 500] }), http({ id: "http-2" })]);
    expect(f).toMatchObject({ category: "healthy", evidence: ["http-2", "dns-1"] });
  });
  it("an asset probe that errored doesn't count as bad caching", () => {
    expect(classify([dns(), http({ asset: { url: goodAsset.url, error: "budget" } })]).category).toBe("healthy");
  });
  it("proposes restore_demo_service for everything except healthy", () => {
    expect(classify([dns(), http()]).actions).toEqual([]);
    expect(classify([dns(), http({ statuses: [500, 500, 500] })]).actions).toEqual(["restore_demo_service"]);
    expect(classify([]).actions).toEqual(["restore_demo_service"]);
  });
});
