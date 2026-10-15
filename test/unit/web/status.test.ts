import { describe, expect, it } from "vitest";
import { watchState } from "../../../web/components/WatchlistPanel";
import { DEMO_MODES } from "../../../demo-service/src/modes";
import { CATEGORY_TEXT } from "../../../web/lib/incident";
import { APPROVAL_TONE, categoryTone, CHECK_TONE, DEMO_MODE_TONE, INCIDENT_TONE, WATCH_TONE } from "../../../web/lib/status";

describe("status colours (TDD §12.2)", () => {
  it("gives each incident status its agreed colour", () => {
    expect(INCIDENT_TONE).toEqual({ investigating: "orange", awaiting_approval: "purple", mitigated: "grey", resolved: "green" });
  });

  it("uses the same colour language for checks, watches and approvals", () => {
    expect(CHECK_TONE).toEqual({ pending: "grey", running: "orange", pass: "green", fail: "red", error: "yellow", unavailable: "grey" });
    expect(WATCH_TONE).toEqual({ incident_open: "orange", fail: "red", pass: "green", unchecked: "grey" });
    expect(APPROVAL_TONE).toEqual({ waiting: "purple", working: "orange", good: "green", bad: "red", closed: "grey" });
  });

  it("an open incident outranks the last check result", () => {
    expect(watchState({ openIncidentId: "i1", lastStatus: "fail" })).toBe("incident_open");
    expect(watchState({ openIncidentId: null, lastStatus: "pass" })).toBe("pass");
    expect(watchState({ openIncidentId: null, lastStatus: null })).toBe("unchecked");
  });

  it("colours the demo mode: healthy green, a problem red, slow yellow", () => {
    for (const m of DEMO_MODES) expect(DEMO_MODE_TONE[m]).toBeDefined();
    expect(DEMO_MODE_TONE).toEqual({ healthy: "green", slow: "yellow", errors: "red", redirect_loop: "red", bad_cache: "red" });
  });

  it("colours the diagnosis: healthy green, inconclusive grey, every real problem red", () => {
    expect(categoryTone("healthy")).toBe("green");
    expect(categoryTone("inconclusive")).toBe("grey");
    for (const c of Object.keys(CATEGORY_TEXT).filter((k) => k !== "healthy" && k !== "inconclusive")) expect(categoryTone(c)).toBe("red");
  });
});
