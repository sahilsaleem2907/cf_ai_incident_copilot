import type { IncidentStatus } from "./state";

/** Monitors (D11, TDD §8.4): quick checks on agent schedule ticks, never inside a Workflow. After an action (15 s) or a `recheck_burst` (60 s). */
export const MONITOR_TICK_S = 15;
export const MONITOR_MAX_TICKS = 10;
/** Passes in a row that resolve a mitigated incident. The verify check after an action counts as the first. */
export const MONITOR_PASSES = 3;
/** `recheck_burst` (WP-24, TDD §5.2): once a minute for 15 minutes. */
export const BURST_TICK_S = 60;
export const BURST_MAX_TICKS = 15;

export type MonitorKind = "post_action" | "burst";
/** How often each kind checks, and for how many ticks. Both use the same `tick()` rules. */
export const MONITOR_KINDS: Record<MonitorKind, { tickS: number; maxTicks: number }> = {
  post_action: { tickS: MONITOR_TICK_S, maxTicks: MONITOR_MAX_TICKS },
  burst: { tickS: BURST_TICK_S, maxTicks: BURST_MAX_TICKS },
};

export type MonitorState = { ticksLeft: number; passes: number };
export type TickResult = {
  monitor: MonitorState | null;
  /** The status to move to, if it changes. */
  to: IncidentStatus | null;
};

/**
 * One tick, pure. A pass counts up (and recovers an investigating incident to mitigated); 3 in a row resolve
 * it. A fail resets the count and reopens a mitigated incident. The monitor ends when resolved or out of ticks.
 */
export function tick(state: MonitorState, status: IncidentStatus, pass: boolean): TickResult {
  const ticksLeft = state.ticksLeft - 1;
  const passes = pass ? state.passes + 1 : 0;
  let to: IncidentStatus | null = null;
  if (pass && status === "investigating") to = "mitigated";
  else if (pass && status === "mitigated" && passes >= MONITOR_PASSES) to = "resolved";
  else if (!pass && status === "mitigated") to = "investigating";
  const done = to === "resolved" || ticksLeft <= 0 || status === "resolved";
  return { monitor: done ? null : { ticksLeft, passes }, to };
}
