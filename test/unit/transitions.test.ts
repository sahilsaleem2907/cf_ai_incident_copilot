import { describe, expect, it } from "vitest";
import type { IncidentStatus } from "../../worker/agent/state";
import { assertTransition, canTransition, IllegalTransition } from "../../worker/agent/transitions";

const ALL: IncidentStatus[] = ["investigating", "awaiting_approval", "mitigated", "resolved"];

/** TDD §10, written out edge by edge. */
const LEGAL: [IncidentStatus, IncidentStatus][] = [
  ["investigating", "awaiting_approval"],
  ["investigating", "resolved"],
  ["investigating", "mitigated"],
  ["awaiting_approval", "investigating"],
  ["awaiting_approval", "mitigated"],
  ["awaiting_approval", "resolved"],
  ["mitigated", "resolved"],
  ["mitigated", "investigating"],
];

describe("transitions", () => {
  it.each(LEGAL)("%s → %s is legal", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  const illegal = ALL.flatMap((from) => ALL.map((to) => [from, to] as [IncidentStatus, IncidentStatus])).filter(
    ([f, t]) => !LEGAL.some(([a, b]) => a === f && b === t),
  );

  it.each(illegal)("%s → %s throws", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(IllegalTransition);
  });

  it("resolved is final", () => {
    expect(ALL.some((to) => canTransition("resolved", to))).toBe(false);
  });
});
