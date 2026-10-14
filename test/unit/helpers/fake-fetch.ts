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

type Records = { A?: string[]; AAAA?: string[]; CNAME?: string[] };
const TYPE = { A: 1, AAAA: 28, CNAME: 5 } as const;

/** Answers DoH JSON queries from a host → records table; unknown hosts get NXDOMAIN. */
export function dohHandler(zone: Record<string, Records>): Handler {
  return (url) => {
    const name = url.searchParams.get("name") ?? "";
    const type = (url.searchParams.get("type") ?? "A") as "A" | "AAAA";
    const rec = zone[name];
    if (!rec) return Response.json({ Status: 3, Answer: [] });
    const answers = [
      ...(rec.CNAME ?? []).map((data) => ({ name, type: TYPE.CNAME, TTL: 300, data })),
      ...(rec[type] ?? []).map((data) => ({ name, type: TYPE[type], TTL: 300, data })),
    ];
    return Response.json({ Status: 0, Answer: answers });
  };
}
