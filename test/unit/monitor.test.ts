import { describe, expect, it } from "vitest";
import { MONITOR_PASSES, tick } from "../../worker/agent/monitor";

describe("monitor tick (TDD §8.4)", () => {
  it("resolves a mitigated incident on the third pass in a row (verify counts as the first)", () => {
    expect(tick({ ticksLeft: 10, passes: 1 }, "mitigated", true)).toEqual({ monitor: { ticksLeft: 9, passes: 2 }, to: null });
    expect(tick({ ticksLeft: 9, passes: MONITOR_PASSES - 1 }, "mitigated", true)).toEqual({ monitor: null, to: "resolved" });
  });

  it("a failure resets the count and reopens a mitigated incident", () => {
    expect(tick({ ticksLeft: 8, passes: 2 }, "mitigated", false)).toEqual({ monitor: { ticksLeft: 7, passes: 0 }, to: "investigating" });
  });

  it("a pass while investigating recovers it to mitigated", () => {
    expect(tick({ ticksLeft: 7, passes: 0 }, "investigating", true)).toEqual({ monitor: { ticksLeft: 6, passes: 1 }, to: "mitigated" });
  });

  it("ends when the ticks run out, leaving the status as it is", () => {
    expect(tick({ ticksLeft: 1, passes: 1 }, "mitigated", true)).toEqual({ monitor: null, to: null });
    expect(tick({ ticksLeft: 1, passes: 0 }, "investigating", false)).toEqual({ monitor: null, to: null });
  });

  it("stops on an incident that was resolved by hand", () => {
    expect(tick({ ticksLeft: 5, passes: 1 }, "resolved", true)).toEqual({ monitor: null, to: null });
  });
});
