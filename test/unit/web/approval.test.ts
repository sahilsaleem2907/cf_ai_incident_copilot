import { describe, expect, it } from "vitest";
import type { ApprovalView } from "../../../worker/agent/state";
import { cardState, whyText } from "../../../web/lib/approval";

type Card = Pick<ApprovalView, "status" | "outcome">;

describe("cardState", () => {
  const cases: [string, Card, string, string][] = [
    ["pending", { status: "pending" }, "Waiting for your approval", "waiting"],
    ["approved, not run yet", { status: "approved" }, "Approved, working on it…", "working"],
    ["approved, action failed", { status: "approved", outcome: { ok: false, text: "x" } }, "Approved, but the action failed", "bad"],
    ["approved, re-check failed", { status: "approved", outcome: { ok: false, text: "x", verified: false } }, "Approved, but still failing", "bad"],
    ["approved, re-check pending", { status: "approved", outcome: { ok: true, text: "x" } }, "Approved, checking it…", "working"],
    ["approved, verified", { status: "approved", outcome: { ok: true, text: "x", verified: true } }, "Approved and verified", "good"],
    ["rejected", { status: "rejected" }, "Rejected", "closed"],
    ["expired", { status: "expired" }, "Expired, no action taken", "closed"],
    ["superseded", { status: "superseded" }, "Replaced by a newer proposal", "closed"],
  ];

  it.each(cases)("%s", (_, card, text, tone) => {
    expect(cardState(card)).toEqual({ text, tone });
  });

  it("only says verified after the re-check passed", () => {
    const said = cases.filter(([, c]) => cardState(c).text.includes("verified")).map(([, c]) => c.outcome?.verified);
    expect(said).toEqual([true]);
  });
});

describe("whyText", () => {
  it("appends the evidence refs when the cause cites none", () => {
    expect(whyText({ cause: "The origin returns 500.", evidence: ["http-1", "dns-1"] })).toBe("The origin returns 500 [http-1] [dns-1].");
    expect(whyText({ cause: "The origin returns 500", evidence: ["http-1"] })).toBe("The origin returns 500 [http-1].");
  });

  it("leaves a cause that cites its own evidence, or has none to cite", () => {
    expect(whyText({ cause: "The origin returns 500 [http-1].", evidence: ["http-1"] })).toBe("The origin returns 500 [http-1].");
    expect(whyText({ cause: "Unknown cause.", evidence: [] })).toBe("Unknown cause.");
  });
});
