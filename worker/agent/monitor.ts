import type { IncidentStatus } from "./state";

/** Post-action monitor (D11, TDD §8.4): quick checks on agent schedule ticks, never inside a Workflow. */
export const MONITOR_TICK_S = 15;
export const MONITOR_MAX_TICKS = 10;
/** Passes in a row that resolve a mitigated incident. The verify check after an action counts as the first. */
export const MONITOR_PASSES = 3;

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
