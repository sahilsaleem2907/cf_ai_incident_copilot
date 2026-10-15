import type { IncidentStatus } from "./state";

/** Legal status edges (TDD §10). Every non-resolved status can be resolved by hand (FR-7). */
const EDGES: Record<IncidentStatus, readonly IncidentStatus[]> = {
  investigating: ["awaiting_approval", "mitigated", "resolved"],
  awaiting_approval: ["investigating", "mitigated", "resolved"],
  mitigated: ["investigating", "resolved"],
  resolved: [],
};

export class IllegalTransition extends Error {
  override name = "IllegalTransition";
}

export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return EDGES[from].includes(to);
}

export function assertTransition(from: IncidentStatus, to: IncidentStatus): void {
  if (!canTransition(from, to)) throw new IllegalTransition(`Illegal transition ${from} → ${to}`);
}
