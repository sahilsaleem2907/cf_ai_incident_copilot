/** Minimal fetch signature so callers can pass a counting or fake fetch. */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export const RR_TYPES = { A: 1, NS: 2, CNAME: 5, MX: 15, TXT: 16, AAAA: 28 } as const;
export type RrType = keyof typeof RR_TYPES;

export const RESOLVERS = {
  cloudflare: "https://cloudflare-dns.com/dns-query",
  google: "https://dns.google/resolve",
} as const;

export type DohAnswer = { name: string; type: number; ttl: number; data: string };
/** `status` is the DNS RCODE: 0 NOERROR, 2 SERVFAIL, 3 NXDOMAIN. */
export type DohResult = { status: number; answers: DohAnswer[] };

const DOH_TIMEOUT_MS = 5_000;

type DohJson = { Status?: number; Answer?: { name: string; type: number; TTL: number; data: string }[] };

/** One DNS-over-HTTPS JSON query. Throws on HTTP or network errors; callers decide how to fail. */
export async function dohQuery(fetchFn: Fetch, resolver: string, name: string, type: RrType): Promise<DohResult> {
  const url = new URL(resolver);
  url.searchParams.set("name", name);
  url.searchParams.set("type", type);
  const res = await fetchFn(url.toString(), {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(DOH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`DoH ${resolver} returned HTTP ${res.status}`);
  const json: DohJson = await res.json();
  return {
    status: json.Status ?? -1,
    answers: (json.Answer ?? []).map((a) => ({ name: a.name, type: a.type, ttl: a.TTL, data: a.data })),
  };
}
