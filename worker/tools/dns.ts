import { z } from "zod";
import { dohQuery, RESOLVERS, RR_TYPES, type RrType } from "../lib/doh";
import { isBlockedIp } from "../safety/iprange";
import { fitDigest } from "./digest";
import type { CheckStatus, ToolContext, ToolResult } from "./types";

export const DNS_TYPES = ["A", "AAAA", "CNAME", "NS", "MX", "TXT"] as const satisfies readonly RrType[];
const HOSTNAME = /^(?=.{1,253}\.?$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\.?$/i;

export const dnsInput = z.object({
  hostname: z
    .string()
    .regex(HOSTNAME, "must be a public hostname, not an IP address or URL")
    .describe("A public hostname like shop.example.com: no scheme, path or IP address.")
    .transform((h) => h.toLowerCase().replace(/\.$/, "")),
  types: z.array(z.enum(DNS_TYPES)).min(1).max(DNS_TYPES.length).default(["A", "AAAA"]),
});
export type DnsInput = z.output<typeof dnsInput>;

const RCODES: Record<number, string> = { 0: "NOERROR", 1: "FORMERR", 2: "SERVFAIL", 3: "NXDOMAIN", 4: "NOTIMP", 5: "REFUSED" };
const TYPE_NAMES = Object.fromEntries(Object.entries(RR_TYPES).map(([k, v]) => [v, k])) as Record<number, string>;
const ADDRESS_TYPES = new Set<number>([RR_TYPES.A, RR_TYPES.AAAA]);
type ResolverName = keyof typeof RESOLVERS;
const RESOLVER_NAMES = Object.keys(RESOLVERS) as ResolverName[];

export type DnsAnswer = { type: string; data: string; ttl: number };
export type TypeResult = { status: string; answers: DnsAnswer[] } | { status: "ERROR"; error: string; answers: [] };

export type DnsRaw = {
  hostname: string;
  types: string[];
  resolvers: Record<ResolverName, Record<string, TypeResult>>;
  addresses: Record<ResolverName, string[]>;
  cnameChain: string[];
  /** CNAME targets the origin pin allows for dns_lookup/cert_info (D6). */
  cnameTargets: string[];
  /** Resolvers disagree on the response code or on whether the name has any address. */
  mismatch: boolean;
  /** Both have addresses but different sets; normal for geo/CDN DNS, informational only. */
  addressesDiffer: boolean;
  ssrfBlocked: boolean;
};

const stripDot = (s: string) => s.replace(/\.$/, "");

export async function runDnsLookup(input: DnsInput, ctx: ToolContext): Promise<ToolResult<DnsRaw>> {
  const jobs = RESOLVER_NAMES.flatMap((resolver) =>
    input.types.map(async (type) => {
      try {
        const r = await dohQuery(ctx.fetch, RESOLVERS[resolver], input.hostname, type);
        const result: TypeResult = {
          status: RCODES[r.status] ?? `RCODE${r.status}`,
          answers: r.answers.map((a) => ({ type: TYPE_NAMES[a.type] ?? String(a.type), data: stripDot(a.data), ttl: a.ttl })),
        };
        return { resolver, type, result };
      } catch (e) {
        if ((e as Error).name === "BudgetExceededError") throw e;
        const result: TypeResult = { status: "ERROR", error: (e as Error).message, answers: [] };
        return { resolver, type, result };
      }
    }),
  );
  const settled = await Promise.all(jobs);

  const resolvers = { cloudflare: {}, google: {} } as DnsRaw["resolvers"];
  for (const { resolver, type, result } of settled) resolvers[resolver][type] = result;

  const addresses = Object.fromEntries(
    RESOLVER_NAMES.map((r) => [
      r,
      [...new Set(Object.values(resolvers[r]).flatMap((t) => t.answers.filter((a) => ADDRESS_TYPES.has(RR_TYPES[a.type as RrType])).map((a) => a.data)))],
    ]),
  ) as Record<ResolverName, string[]>;

  const cnameChain = [
    ...new Set(
      RESOLVER_NAMES.flatMap((r) => Object.values(resolvers[r]).flatMap((t) => t.answers.filter((a) => a.type === "CNAME").map((a) => a.data))),
    ),
  ];

  const wantsAddresses = input.types.some((t) => t === "A" || t === "AAAA");
  const answered = (r: ResolverName) => Object.values(resolvers[r]).some((t) => t.status !== "ERROR");
  const bothAnswered = RESOLVER_NAMES.every(answered);

  let mismatch = false;
  if (bothAnswered) {
    for (const type of input.types) {
      const a = resolvers.cloudflare[type]!;
      const b = resolvers.google[type]!;
      if (a.status !== "ERROR" && b.status !== "ERROR" && a.status !== b.status) mismatch = true;
    }
    if (wantsAddresses && addresses.cloudflare.length > 0 !== addresses.google.length > 0) mismatch = true;
  }
  const sorted = (xs: string[]) => [...xs].sort().join(",");
  const addressesDiffer =
    addresses.cloudflare.length > 0 && addresses.google.length > 0 && sorted(addresses.cloudflare) !== sorted(addresses.google);
  const ssrfBlocked = RESOLVER_NAMES.some((r) => addresses[r].some((ip) => isBlockedIp(ip)));

  const raw: DnsRaw = {
    hostname: input.hostname,
    types: input.types,
    resolvers,
    addresses,
    cnameChain,
    cnameTargets: cnameChain,
    mismatch,
    addressesDiffer,
    ssrfBlocked,
  };

  const { status, summary } = judge(raw, wantsAddresses, RESOLVER_NAMES.some(answered));
  return {
    evidenceId: ctx.evidenceId,
    tool: "dns_lookup",
    ok: status === "pass" || status === "fail",
    status,
    summary,
    digest: dnsDigest(raw),
    raw,
  };
}

function judge(raw: DnsRaw, wantsAddresses: boolean, anyAnswered: boolean): { status: CheckStatus; summary: string } {
  if (!anyAnswered) return { status: "unavailable", summary: "Both DNS resolvers failed to answer." };

  const statuses = RESOLVER_NAMES.map((r) => ({ r, s: [...new Set(Object.values(raw.resolvers[r]).map((t) => t.status))].join("/") }));
  if (raw.mismatch) {
    return { status: "fail", summary: `Resolvers disagree: ${statuses.map(({ r, s }) => `${r} ${s}`).join(", ")}.` };
  }
  const bad = RESOLVER_NAMES.flatMap((r) => Object.values(raw.resolvers[r])).find((t) => t.status !== "NOERROR" && t.status !== "ERROR");
  if (bad) return { status: "fail", summary: `${bad.status}: the name doesn't resolve.` };

  const addrs = raw.addresses.cloudflare.length ? raw.addresses.cloudflare : raw.addresses.google;
  if (wantsAddresses && addrs.length === 0) return { status: "fail", summary: "No A or AAAA records." };

  const parts: string[] = [];
  if (addrs.length) parts.push(`${addrs.slice(0, 3).join(", ")}${addrs.length > 3 ? ` +${addrs.length - 3}` : ""}`);
  if (raw.cnameChain.length) parts.push(`via ${raw.cnameChain.join(" → ")}`);
  parts.push(raw.addressesDiffer ? "addresses differ by resolver (normal for CDNs)" : "both resolvers agree");
  if (raw.ssrfBlocked) parts.push("resolves to a private address");
  return { status: "pass", summary: parts.join(" · ") };
}

function dnsDigest(raw: DnsRaw): string {
  const line = (t: TypeResult) => {
    if (t.status === "ERROR") return "ERROR";
    const data = t.answers.slice(0, 4).map((a) => `${a.type} ${a.data} ttl=${a.ttl}`);
    if (t.answers.length > 4) data.push(`+${t.answers.length - 4} more`);
    return [t.status, ...data].join(" ");
  };
  const per = (r: ResolverName) => Object.fromEntries(Object.entries(raw.resolvers[r]).map(([type, t]) => [type, line(t)]));
  return fitDigest(
    {
      host: raw.hostname,
      cloudflare: per("cloudflare"),
      google: per("google"),
      cname: raw.cnameChain,
      mismatch: raw.mismatch,
      addressesDiffer: raw.addressesDiffer,
      ssrfBlocked: raw.ssrfBlocked,
    },
    ["google", "cname"],
  );
}
