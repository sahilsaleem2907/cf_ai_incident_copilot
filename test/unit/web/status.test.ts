import { describe, expect, it } from "vitest";
import { watchState } from "../../../web/components/WatchlistPanel";
import { APPROVAL_TONE, CHECK_TONE, INCIDENT_TONE, WATCH_TONE } from "../../../web/lib/status";

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
});
