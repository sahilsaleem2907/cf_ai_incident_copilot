import type { ApprovalView } from "../../worker/agent/state";

export type CardState = { text: string; tone: "waiting" | "working" | "good" | "bad" | "closed" };

/** What an approval card says about itself (TDD §12.2): always in words, never colour alone. */
export function cardState(a: Pick<ApprovalView, "status" | "outcome">): CardState {
  switch (a.status) {
    case "pending":
      return { text: "Waiting for your approval", tone: "waiting" };
    case "approved":
      if (!a.outcome) return { text: "Approved, working on it…", tone: "working" };
      if (!a.outcome.ok) return a.outcome.verified === false ? { text: "Approved, but still failing", tone: "bad" } : { text: "Approved, but the action failed", tone: "bad" };
      // The action ran; the card only says "verified" once the re-check after it has passed.
      return a.outcome.verified ? { text: "Approved and verified", tone: "good" } : { text: "Approved, checking it…", tone: "working" };
    case "rejected":
      return { text: "Rejected", tone: "closed" };
    case "expired":
      return { text: "Expired, no action taken", tone: "closed" };
    case "superseded":
      return { text: "Replaced by a newer proposal", tone: "closed" };
  }
}

/** The "why" as markdown: the cause, with its evidence refs appended when the text doesn't cite them itself. */
export function whyText(a: Pick<ApprovalView, "cause" | "evidence">): string {
  if (/\[[a-z]+-\d+\]/.test(a.cause) || a.evidence.length === 0) return a.cause;
  return `${a.cause.replace(/\.?\s*$/, "")} ${a.evidence.map((id) => `[${id}]`).join(" ")}.`;
}
