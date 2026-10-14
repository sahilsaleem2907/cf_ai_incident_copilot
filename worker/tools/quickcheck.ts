import type { Fetch } from "../lib/doh";
import { countingFetch, HIGH_LATENCY_TOTAL_MS, SubrequestCounter } from "../loop/budget";
import { followHops, type HopStop } from "../safety/reader";
import { createGuard } from "../safety/ssrf";

/** Guard DoH (A + AAAA) + 1 GET following up to 5 hops = 8; 10 leaves room for one cross-host redirect. */
export const QUICKCHECK_CAP = 10;

export type QuickCheckResult = {
  pass: boolean;
  status: number | null;
  totalMs: number;
  stop: HopStop | "budget";
  /** Why it didn't pass: an SSRF code, "timeout"/"network", "http_<status>", "slow", "loop", … */
  reason?: string;
  subrequests: number;
};

/** One cheap health check with no LLM (cron, monitor ticks, verify after an action). */
export async function quickCheck(
  url: string,
  deps: { fetch: Fetch; allowOrigin?: string; now?: () => number; cap?: number },
): Promise<QuickCheckResult> {
  const counter = new SubrequestCounter(deps.cap ?? QUICKCHECK_CAP);
  const fetchFn = countingFetch(deps.fetch, counter);
  const guard = createGuard({ fetch: fetchFn, allowOrigin: deps.allowOrigin });

  let r;
  try {
    r = await followHops(fetchFn, guard, url, "GET", { now: deps.now });
  } catch (e) {
    if ((e as Error).name === "BudgetExceededError") {
      return { pass: false, status: null, totalMs: 0, stop: "budget", reason: "budget", subrequests: counter.count };
    }
    throw e;
  }

  const totalMs = r.hops.reduce((sum, h) => sum + h.totalMs, 0);
  const status = r.stop === "done" ? (r.final?.status ?? null) : null;
  let reason: string | undefined;
  if (r.stop === "blocked") reason = r.blocked?.code;
  else if (r.stop === "error") reason = r.error?.error;
  else if (r.stop !== "done") reason = r.stop;
  else if (status === null || status >= 400) reason = `http_${status}`;
  else if (totalMs >= HIGH_LATENCY_TOTAL_MS) reason = "slow";

  return { pass: reason === undefined, status, totalMs, stop: r.stop, ...(reason ? { reason } : {}), subrequests: counter.count };
}
