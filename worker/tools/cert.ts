import { z } from "zod";
import type { CertRaw } from "../diagnosis/categories";
import { readOnce } from "../safety/reader";
import { fitDigest } from "./digest";
import { dnsInput } from "./dns";
import type { CheckStatus, ToolContext, ToolResult } from "./types";

/** crt.sh can return megabytes for big domains, and the free plan has 10 ms of CPU per step (PRD §6.1). */
export const CRT_READ_CAP = 256 * 1024;
export const CRT_MAX_ENTRIES = 20;
export const CRT_CACHE_TTL_S = 3600;
/** crt.sh took 2–12 s in the WP-21 spike (and timed out at 30 s for cloudflare.com). */
const CRT_TIMEOUT_MS = 10_000;
/** The host itself, plus `*.parent` for wildcard certificates (an exact-host query doesn't find those). */
export const CERT_CAP = 2;
const CERT_WARN_DAYS = 7;
const DAY_MS = 86_400_000;

export const certInput = z.object({ hostname: dnsInput.shape.hostname });
export type CertInput = z.output<typeof certInput>;

type CrtEntry = { id?: number; serial_number?: string; issuer_name?: string; common_name?: string; name_value?: string; not_before?: string; not_after?: string };
type Cert = CertRaw["certs"][number];

export function crtUrl(query: string): string {
  return `https://crt.sh/?q=${encodeURIComponent(query)}&output=json&exclude=expired&deduplicate=Y`;
}

/** `*.parent` when the host has a parent that isn't a bare TLD. */
export function certQueries(hostname: string): string[] {
  const labels = hostname.split(".");
  return labels.length >= 3 ? [hostname, `*.${labels.slice(1).join(".")}`] : [hostname];
}

/** A SAN matches the host itself, or as a wildcard one label up (`*.example.com` covers `shop.example.com`). */
export function sanMatches(hostname: string, name: string): boolean {
  const n = name.trim().toLowerCase().replace(/\.$/, "");
  if (n === hostname) return true;
  if (!n.startsWith("*.")) return false;
  const dot = hostname.indexOf(".");
  return dot > 0 && hostname.slice(dot + 1) === n.slice(2);
}

/**
 * crt.sh JSON, at most `CRT_MAX_ENTRIES` entries. A body cut off by the read cap is parsed up to its last
 * complete entry. Null when it isn't a JSON array.
 */
export function parseCrt(body: string, truncated: boolean): CrtEntry[] | null {
  const asArray = (text: string) => {
    const j: unknown = JSON.parse(text);
    return Array.isArray(j) ? (j.slice(0, CRT_MAX_ENTRIES) as CrtEntry[]) : null;
  };
  try {
    return asArray(body);
  } catch {
    if (!truncated) return null;
  }
  const cut = body.lastIndexOf("},{");
  if (cut < 0) return null;
  try {
    return asArray(`${body.slice(0, cut + 1)}]`);
  } catch {
    return null;
  }
}

/** The issuer's CN rather than the whole DN; a bare code like "YE2" gets its organisation ("Let's Encrypt YE2"). */
function issuerName(dn: string): string {
  const cn = /(?:^|,\s*)CN=([^,]+)/.exec(dn)?.[1];
  const org = /(?:^|,\s*)O=([^,]+)/.exec(dn)?.[1];
  if (cn && org && !/\s/.test(cn)) return `${org} ${cn}`.slice(0, 120);
  return (cn ?? dn).slice(0, 120);
}

/** crt.sh times are UTC without a zone. */
const utc = (t: string) => Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`);

function toCert(e: CrtEntry, hostname: string, now: number): Cert | null {
  if (!e.not_after || !e.not_before) return null;
  const notAfter = utc(e.not_after);
  if (Number.isNaN(notAfter)) return null;
  const names = [...(e.name_value ?? "").split("\n"), e.common_name ?? ""].filter(Boolean);
  return {
    issuer: issuerName(e.issuer_name ?? "unknown"),
    notBefore: e.not_before,
    notAfter: e.not_after,
    daysToExpiry: Math.floor((notAfter - now) / DAY_MS),
    sanMatch: names.some((n) => sanMatches(hostname, n)),
  };
}

function defaultCache(): Pick<Cache, "match" | "put"> | null {
  try {
    return (globalThis as { caches?: CacheStorage & { default?: Cache } }).caches?.default ?? null;
  } catch {
    return null;
  }
}

type Fetched = { ok: true; entries: CrtEntry[] } | { ok: false; reason: string };

/** One crt.sh query, through an hour's cache. Every cache call is best effort: a broken cache never fails the check. */
async function queryCrt(ctx: ToolContext, url: string, now: () => number): Promise<Fetched> {
  const cache = ctx.cache === undefined ? defaultCache() : ctx.cache;
  try {
    const hit = await cache?.match(url);
    if (hit) {
      const entries = parseCrt(await hit.text(), true);
      if (entries) return { ok: true, entries };
    }
  } catch {
    // ignore: fetch instead
  }
  const res = await readOnce(ctx.fetch, url, "GET", { readCap: CRT_READ_CAP, timeoutMs: CRT_TIMEOUT_MS, now });
  if (!res.ok) return { ok: false, reason: res.error };
  if (res.status !== 200) return { ok: false, reason: `HTTP ${res.status}` };
  const entries = parseCrt(res.body, res.truncated);
  if (!entries) return { ok: false, reason: "not JSON" };
  try {
    await cache?.put(url, new Response(JSON.stringify(entries), { headers: { "content-type": "application/json", "cache-control": `max-age=${CRT_CACHE_TTL_S}` } }));
  } catch {
    // ignore: the next run asks crt.sh again
  }
  return { ok: true, entries };
}

/**
 * `cert_info` (TDD §7.3): unexpired certificates for the host from certificate-transparency logs (crt.sh).
 * Best effort: CT logs show certificates that were issued, not necessarily the one being served, and crt.sh is
 * often slow or down, which makes the check `unavailable`, never a failure (PRD R4).
 */
export async function runCertInfo(input: CertInput, ctx: ToolContext): Promise<ToolResult<CertRaw>> {
  const now = ctx.now ?? (() => Date.now());
  const queries = certQueries(input.hostname);
  const answers = await Promise.all(queries.map(async (q) => ({ q, r: await queryCrt(ctx, crtUrl(q), now) })));
  const failed = answers.filter((a) => !a.r.ok).map((a) => a.q);

  const seen = new Set<string>();
  const certs: Cert[] = [];
  for (const { r } of answers) {
    if (!r.ok) continue;
    for (const e of r.entries) {
      const key = e.serial_number ?? String(e.id ?? "");
      if (key && seen.has(key)) continue;
      seen.add(key);
      const c = toCert(e, input.hostname, now());
      if (c) certs.push(c);
    }
  }
  // Matching certificates first, then the most days left.
  certs.sort((a, b) => Number(b.sanMatch) - Number(a.sanMatch) || b.daysToExpiry - a.daysToExpiry);
  const raw: CertRaw = { hostname: input.hostname, certs: certs.slice(0, 3), queries, ...(failed.length ? { failed } : {}) };

  const { status, summary } = judge(raw, failed.length === queries.length);
  return {
    evidenceId: ctx.evidenceId,
    tool: "cert_info",
    ok: status === "pass" || status === "fail",
    status,
    summary,
    digest: fitDigest({ host: raw.hostname, source: "CT logs (crt.sh), best effort", certs: raw.certs, failed: raw.failed }, ["failed"]),
    raw,
  };
}

function judge(raw: CertRaw, allFailed: boolean): { status: CheckStatus; summary: string } {
  const prefix = "CT logs (best effort):";
  if (allFailed) return { status: "unavailable", summary: "Certificate info unavailable: crt.sh didn't answer." };
  const best = raw.certs.find((c) => c.sanMatch);
  if (!best) {
    // A missing answer might have held the certificate: don't call it missing.
    if (raw.failed?.length) return { status: "unavailable", summary: `Certificate info incomplete: crt.sh didn't answer for ${raw.failed.join(", ")}.` };
    return { status: "fail", summary: `${prefix} no unexpired certificate covers ${raw.hostname}.` };
  }
  const until = best.notAfter.slice(0, 10);
  if (best.daysToExpiry < 0) return { status: "fail", summary: `${prefix} the newest certificate expired on ${until}.` };
  if (best.daysToExpiry <= CERT_WARN_DAYS) return { status: "fail", summary: `${prefix} the newest certificate expires in ${best.daysToExpiry} day(s), on ${until} (${best.issuer}).` };
  return { status: "pass", summary: `${prefix} valid until ${until} (${best.daysToExpiry} days), issued by ${best.issuer}.` };
}
