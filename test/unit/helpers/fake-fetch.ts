import type { Fetch } from "../../../worker/lib/doh";

export type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>;

/** A fetch stub that records every call and dispatches to `handler`. */
export function fakeFetch(handler: Handler): Fetch & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (input: string, init?: RequestInit) => {
    calls.push(input);
    return handler(new URL(input), init);
  }) as Fetch & { calls: string[] };
  fn.calls = calls;
  return fn;
}

/** Dispatches by hostname; unknown hosts fail like a dead network. */
export function byHost(hosts: Record<string, Handler>): Handler {
  return (url, init) => {
    const h = hosts[url.hostname];
    if (!h) return Promise.reject(new TypeError(`no route to ${url.hostname}`));
    return h(url, init);
  };
}

export type Records = { status?: number; A?: string[]; AAAA?: string[]; CNAME?: string[]; MX?: string[] };
const TYPE = { A: 1, AAAA: 28, CNAME: 5, MX: 15 } as const;

/** Answers DoH JSON queries from a host → records table; unknown hosts get NXDOMAIN. */
export function dohHandler(zone: Record<string, Records>): Handler {
  return (url) => {
    const name = url.searchParams.get("name") ?? "";
    const type = (url.searchParams.get("type") ?? "A") as keyof typeof TYPE;
    const rec = zone[name];
    if (!rec) return Response.json({ Status: 3 });
    if (rec.status && rec.status !== 0) return Response.json({ Status: rec.status });
    const answers = [
      ...(type === "CNAME" ? [] : (rec.CNAME ?? [])).map((data) => ({ name, type: TYPE.CNAME, TTL: 300, data })),
      ...((rec[type] as string[] | undefined) ?? []).map((data) => ({ name, type: TYPE[type], TTL: 300, data })),
    ];
    return Response.json({ Status: 0, Answer: answers });
  };
}

/** Manually advanced clock for latency assertions. */
export function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}
