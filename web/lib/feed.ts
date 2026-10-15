import type { CheckView, IncidentState, MessageView } from "../../worker/agent/state";
import type { Streams } from "./stream";

export type CheckDisplayStatus = CheckView["status"];

export type FeedItem =
  | { kind: "message"; key: string; message: MessageView }
  | { kind: "check"; key: string; check: CheckView; status: CheckDisplayStatus }
  | { kind: "stream"; key: string; messageId: string; text: string };

/**
 * The chat in run order: each run's opening message, then that run's checks, then its narration. While a
 * narration is still streaming, its live buffer takes the narration's place. Messages without a run (and
 * checks of runs without an opening message) keep their time order.
 */
export function buildFeed(state: Pick<IncidentState, "messages" | "checks" | "activeRunId">, streams: Streams): FeedItem[] {
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

  for (const m of state.messages) {
    items.push({ kind: "message", key: `msg-${m.id}`, message: m });
    if (m.runId && m.role !== "assistant" && !opened.has(m.runId)) openRun(m.runId);
  }
  for (const runId of checksByRun.keys()) if (!opened.has(runId)) openRun(runId);
  return items;
}
