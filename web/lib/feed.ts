import type { ApprovalView, CheckView, IncidentState, MessageView } from "../../worker/agent/state";
import type { Streams } from "./stream";

export type CheckDisplayStatus = CheckView["status"];

export type FeedItem =
  | { kind: "message"; key: string; message: MessageView }
  | { kind: "check"; key: string; check: CheckView; status: CheckDisplayStatus }
  | { kind: "stream"; key: string; messageId: string; text: string }
  | { kind: "approval"; key: string; approval: ApprovalView };

/**
 * The chat in run order: each run's opening message, then that run's checks, then its narration. While a
 * narration is still streaming, its live buffer takes the narration's place. Messages without a run (and
 * checks of runs without an opening message) keep their time order. An approval card follows its run's
 * narration (the run proposes it right after narrating).
 */
export function buildFeed(state: Pick<IncidentState, "messages" | "checks" | "activeRunId" | "approvals">, streams: Streams): FeedItem[] {
  const stored = new Set(state.messages.map((m) => m.id));
  const checksByRun = new Map<string, CheckView[]>();
  for (const c of state.checks) checksByRun.set(c.runId, [...(checksByRun.get(c.runId) ?? []), c]);

  const items: FeedItem[] = [];
  const opened = new Set<string>();
  const openRun = (runId: string) => {
    opened.add(runId);
    for (const c of checksByRun.get(runId) ?? []) {
      // Pending checks of the active run are being worked on right now.
      const status = c.status === "pending" && state.activeRunId === runId ? "running" : c.status;
      items.push({ kind: "check", key: `check-${c.evidenceId}`, check: c, status });
    }
    const stream = streams[`narr-${runId}`];
    if (stream && !stored.has(stream.messageId)) items.push({ kind: "stream", key: `stream-${stream.messageId}`, messageId: stream.messageId, text: stream.text });
  };

  const approvals = [...state.approvals].sort((a, b) => a.createdAt - b.createdAt);
  const placed = new Set<string>();
  const cardsFor = (runId: string) => {
    for (const a of approvals) {
      if (a.runId !== runId || placed.has(a.id)) continue;
      placed.add(a.id);
      items.push({ kind: "approval", key: `approval-${a.id}`, approval: a });
    }
  };

  for (const m of state.messages) {
    items.push({ kind: "message", key: `msg-${m.id}`, message: m });
    if (m.runId && m.role !== "assistant" && !opened.has(m.runId)) openRun(m.runId);
    if (m.runId && m.role === "assistant") cardsFor(m.runId);
  }
  for (const runId of checksByRun.keys()) if (!opened.has(runId)) openRun(runId);
  // Cards whose narration fell out of the message window still show, oldest first.
  for (const a of approvals) cardsFor(a.runId);
  return items;
}

/**
 * What the chat says it's doing while a run is active (TDD §12.2): checks first, then the diagnosis. Nothing once
 * the narration's text is streaming (the text is the progress) or when no run is active.
 */
export function workingLabel(feed: readonly FeedItem[], active: boolean): string | null {
  if (!active) return null;
  const last = feed.at(-1);
  if (last?.kind === "stream" && last.text) return null;
  // buildFeed shows the active run's waiting checks as running; a finished run's leftover "pending" doesn't count.
  const checking = feed.some((i) => i.kind === "check" && i.status === "running");
  if (checking || (last?.kind === "message" && last.message.role === "user")) return "Running checks…";
  return "Writing the diagnosis…";
}
