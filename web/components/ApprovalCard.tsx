import { Badge, Button, Loader, Surface } from "@cloudflare/kumo";
import { CheckCircleIcon, HourglassIcon, MinusCircleIcon, ShieldCheckIcon, XCircleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { ApprovalView } from "../../worker/agent/state";
import { cardState, whyText, type CardState } from "../lib/approval";
import { Markdown } from "./Markdown";

const BADGE: Record<CardState["tone"], { variant: "warning" | "info" | "success" | "error" | "neutral"; icon: React.ReactNode }> = {
  waiting: { variant: "warning", icon: <HourglassIcon aria-hidden size={14} /> },
  working: { variant: "info", icon: <Loader size={12} /> },
  good: { variant: "success", icon: <CheckCircleIcon aria-hidden size={14} weight="fill" /> },
  bad: { variant: "error", icon: <XCircleIcon aria-hidden size={14} weight="fill" /> },
  closed: { variant: "neutral", icon: <MinusCircleIcon aria-hidden size={14} /> },
};

type Props = {
  approval: ApprovalView;
  knownIds: ReadonlySet<string>;
  /** Owner only (D8): viewers see the card without buttons. */
  onDecide?: (id: string, decision: "approve" | "reject") => Promise<unknown>;
};

/** A proposed action waiting for a human (FR-20, TDD §12.2). Nothing runs until Approve is clicked. */
export function ApprovalCard({ approval, knownIds, onDecide }: Props) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const state = cardState(approval);
  const badge = BADGE[state.tone];
  const titleId = `approval-${approval.id}`;

  const decide = async (decision: "approve" | "reject") => {
    if (!onDecide) return;
    setBusy(decision);
    setError(null);
    try {
      await onDecide(approval.id, decision);
    } catch {
      setError("That didn't go through. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Surface
      role="group"
      aria-labelledby={titleId}
      className={`rounded-lg border p-4 ${approval.status === "pending" ? "border-cf-orange" : "border-(--cf-border)"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheckIcon aria-hidden size={18} className="text-(--cf-fg-muted)" />
        <span className="text-xs tracking-wide text-(--cf-fg-muted) uppercase">Proposed action</span>
        <Badge variant={badge.variant} icon={badge.icon}>
          {state.text}
        </Badge>
      </div>
      <h3 id={titleId} className="mt-2 font-medium">
        {approval.title}
      </h3>
      {approval.cause && (
        <div className="mt-2 text-sm">
          <span className="font-medium">Why: </span>
          <Markdown text={whyText(approval)} knownIds={knownIds} />
        </div>
      )}
      {approval.outcome && <p className="mt-2 text-sm text-(--cf-fg-muted)">{approval.outcome.text}</p>}

      {approval.status === "pending" && onDecide && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" icon={CheckCircleIcon} loading={busy === "approve"} disabled={!!busy} onClick={() => void decide("approve")}>
            Approve
          </Button>
          <Button variant="secondary" icon={XCircleIcon} loading={busy === "reject"} disabled={!!busy} onClick={() => void decide("reject")}>
            Reject
          </Button>
        </div>
      )}
      {approval.status === "pending" && !onDecide && <p className="mt-3 text-sm text-(--cf-fg-muted)">Only the incident's owner can approve this.</p>}
      {error && (
        <p role="alert" className="mt-2 text-sm">
          {error}
        </p>
      )}
    </Surface>
  );
}
