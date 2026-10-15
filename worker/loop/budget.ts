import type { Fetch } from "../lib/doh";

/** Run bounds (TDD §5.2). */
export const MAX_TOOL_CALLS = 6;
export const MAX_PLAN_TURNS = 3;
export const RUN_DEADLINE_MS = 60_000;
export const SUBREQUEST_BUDGET = 45;
export const HTTP_SAMPLES = 3;
export const SNIPPET_TO_LLM = 500;
export const EVIDENCE_DIGEST_MAX = 1536;
export const HIGH_LATENCY_TOTAL_MS = 2000;
export const HIGH_LATENCY_TTFB_MS = 1500;
/** Per LLM call. gpt once took 19 s on a forced submit_findings turn; a timeout moves to the fast fallback. */
export const LLM_TIMEOUT_MS = 25_000;
/** Workers AI free allocation per day, and where the budget guard switches to rule-based mode (WP-17). */
export const NEURON_DAILY = 10_000;
export const BUDGET_GUARD_AT = 9_000;

export class BudgetExceededError extends Error {
  override name = "BudgetExceededError";
}

/**
 * Per-run subrequest budget. Serialisable so it can live in the run row between Workflow steps.
 * A tool reserves its worst case up front, then settles with what it actually used.
 */
export class SubrequestBudget {
  constructor(
    readonly limit: number = SUBREQUEST_BUDGET,
    private used = 0,
    private reserved = 0,
  ) {}

  static from(json: { limit: number; used: number; reserved?: number }): SubrequestBudget {
    return new SubrequestBudget(json.limit, json.used, json.reserved ?? 0);
  }

  toJSON() {
    return { limit: this.limit, used: this.used, reserved: this.reserved };
  }

  get spent(): number {
    return this.used;
  }

  remaining(): number {
    return this.limit - this.used - this.reserved;
  }

  reserve(n: number): boolean {
    if (n > this.remaining()) return false;
    this.reserved += n;
    return true;
  }

  settle(reserved: number, actual: number): void {
    this.reserved = Math.max(0, this.reserved - reserved);
    this.used += actual;
  }
}

/** Counts real outbound requests against a hard cap; used inside a tool call and by cron. */
export class SubrequestCounter {
  count = 0;
  constructor(readonly limit: number) {}
}

export function countingFetch(fetchFn: Fetch, counter: SubrequestCounter): Fetch {
  return (input, init) => {
    if (counter.count >= counter.limit) {
      return Promise.reject(new BudgetExceededError(`Subrequest limit of ${counter.limit} reached.`));
    }
    counter.count++;
    return fetchFn(input, init);
  };
}
