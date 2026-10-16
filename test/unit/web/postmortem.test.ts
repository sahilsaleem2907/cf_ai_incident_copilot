import { describe, expect, it } from "vitest";
import { postmortemButton, postmortemErrorText } from "../../../web/lib/postmortem";

describe("Postmortem button (WP-22)", () => {
  it("the owner always sees it, enabled once resolved", () => {
    expect(postmortemButton("owner", "resolved", false)).toEqual({ show: true, label: "Postmortem", disabledReason: null });
    expect(postmortemButton("owner", "mitigated", false)).toEqual({ show: true, label: "Postmortem", disabledReason: "Available once the incident is resolved." });
  });

  it("a viewer sees it only once one exists; nobody sees it before the role is known", () => {
    expect(postmortemButton("viewer", "resolved", false).show).toBe(false);
    expect(postmortemButton("viewer", "resolved", true)).toEqual({ show: true, label: "View postmortem", disabledReason: null });
    expect(postmortemButton(null, "resolved", true).show).toBe(false);
  });

  it("explains failures in words", () => {
    expect(postmortemErrorText("rate_limited:30")).toBe("Run limit reached. Try again in about a minute.");
    expect(postmortemErrorText("Error: not_resolved")).toBe("Resolve the incident first, then write its postmortem.");
    expect(postmortemErrorText("forbidden: this incident link is view-only")).toBe("Only the incident's owner can write its postmortem.");
    expect(postmortemErrorText("boom")).toBe("Couldn't write the postmortem. Try again.");
  });
});
