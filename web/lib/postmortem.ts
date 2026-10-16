import type { ConnectionRole, IncidentStatus } from "../../worker/agent/state";
import { parseRateLimited, rateLimitedText } from "./api";

/** The incident header's Postmortem button (TDD §12.2, WP-22): who sees it and when it works. */
export function postmortemButton(role: ConnectionRole | null, status: IncidentStatus, hasPostmortem: boolean): { show: boolean; label: string; disabledReason: string | null } {
  if (role === "viewer") return { show: hasPostmortem, label: "View postmortem", disabledReason: null };
  if (role !== "owner") return { show: false, label: "Postmortem", disabledReason: null };
  return { show: true, label: "Postmortem", disabledReason: status === "resolved" ? null : "Available once the incident is resolved." };
}

/** A failed `generatePostmortem` call in words. */
export function postmortemErrorText(message: string): string {
  const retryAfter = parseRateLimited(message);
  if (retryAfter !== null) return rateLimitedText(retryAfter);
  if (message.includes("not_resolved")) return "Resolve the incident first, then write its postmortem.";
  if (message.includes("view-only")) return "Only the incident's owner can write its postmortem.";
  return "Couldn't write the postmortem. Try again.";
}
