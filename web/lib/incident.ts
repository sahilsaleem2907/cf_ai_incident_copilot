import type { IncidentStatus, RunStatus, TimelineView } from "../../worker/agent/state";
import { parseTarget } from "../../worker/safety/target";
import { CATEGORY_LABEL } from "../../worker/diagnosis/categories";

/**
 * A follow-up that names a different host than the incident's (TDD §8.6). Tools are pinned to the incident's
 * origin (D6), so the UI offers a new incident instead of sending. "demo" alone doesn't count.
 */
export function otherHost(text: string, incidentHost: string): string | null {
  const r = parseTarget(text, "https://demo.invalid/");
  if (!r.ok || r.source === "demo") return null;
  return r.host === incidentHost.toLowerCase() ? null : r.host;
}

const LIMIT_NOTES: Partial<Record<RunStatus, string>> = {
  limit_turns: "Stopped at the 3-turn limit.",
  limit_tools: "Stopped at the 6-check limit.",
  limit_budget: "Stopped when this run's request budget ran out.",
  limit_deadline: "Stopped at the 60-second limit.",
};

/**
 * Says which limit ended the latest run (TDD §8.2 "Limits keep progress"), or that it failed. Nothing while
 * a newer run is in progress, or when the run simply finished.
 */
export function runNote(timeline: readonly TimelineView[]): string | null {
  const last = [...timeline].reverse().find((t) => t.type === "run_finished" || t.type === "run_started");
  if (!last || last.type !== "run_finished") return null;
  const status = last.detail.status as RunStatus;
  if (status === "failed") return "This run failed before it finished. Try asking again.";
  const note = LIMIT_NOTES[status];
  return note ? `${note} The diagnosis uses the checks it completed.` : null;
}

export const STATUS_TEXT: Record<IncidentStatus, string> = {
  investigating: "Investigating",
  awaiting_approval: "Awaiting approval",
  mitigated: "Mitigated",
  resolved: "Resolved",
};

export const CATEGORY_TEXT: Record<string, string> = CATEGORY_LABEL;
