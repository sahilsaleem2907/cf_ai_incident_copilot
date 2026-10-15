import type { Category, Confidence, Findings } from "../diagnosis/categories";
import type { CheckStatus, ToolName } from "../tools/types";

/** JSON values: anything stored in state or returned over RPC must be serialisable. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
/** Timeline details are flat on purpose: a recursive type in the state makes RPC stub types too deep. */
export type Scalar = string | number | boolean | null;

/** Synced state (TDD §6.3): small on purpose; full evidence goes through `getEvidence`. */
export type IncidentStatus = "investigating" | "awaiting_approval" | "mitigated" | "resolved";
export type Origin = "chat" | "watch";
export type RunMode = "ai" | "rule_based";
export type RunKind = "initial" | "followup";
/** Why a run ended (TDD §8.2 "Limits keep progress"); `running` while it's active. */
export const RUN_STATUSES = ["running", "done", "limit_turns", "limit_tools", "limit_deadline", "limit_budget", "llm_unavailable", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export type CheckView = {
  evidenceId: string;
  runId: string;
  tool: ToolName;
  label: string;
  status: "pending" | "running" | CheckStatus;
  summary: string;
  startedAt: number;
  finishedAt?: number;
};
export type MessageView = { id: string; runId: string | null; role: "user" | "assistant" | "system"; content: string; createdAt: number };
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "superseded";
/** An approval card (TDD §12.2). `cause`/`evidence` come from the proposing run's findings, so an old card keeps its own "why". */
export type ApprovalView = {
  id: string;
  runId: string;
  actionId: string;
  title: string;
  status: ApprovalStatus;
  cause: string;
  evidence: string[];
  /** What happened after the decision. `verified` is set once the re-check after the action has run. */
  /** `verified`: the re-check after a fix. `done`: an action with nothing to re-check (add_to_watchlist). */
  outcome?: { ok: boolean; text: string; verified?: boolean; done?: boolean };
  createdAt: number;
  decidedAt?: number;
};
export type TimelineView = { id: number; ts: number; type: string; detail: Record<string, Scalar> };

export type IncidentState = {
  id: string;
  target: string;
  origin: Origin;
  status: IncidentStatus;
  category: Category | null;
  confidence: Confidence | null;
  /** Mode of the latest run. */
  mode: RunMode;
  /** Non-null → the composer is disabled (D13). */
  activeRunId: string | null;
  /** Latest run's findings (for the approval card's "why"). */
  findings: Findings | null;
  checks: CheckView[];
  messages: MessageView[];
  approvals: ApprovalView[];
  timeline: TimelineView[];
  monitor: { kind: "post_action" | "burst"; passes: number; ticksLeft: number } | null;
  hasPostmortem: boolean;
};

/** WebSocket side channel (broadcast, not state). `stream_start` resets the buffer when a retried narration restreams. */
export type StreamFrame = { type: "stream_start"; messageId: string } | { type: "delta"; messageId: string; text: string } | { type: "stream_end"; messageId: string };

export type ConnectionRole = "owner" | "viewer";
/** `ip` is the visitor's hashed `ipKey` (safety/quota.ts) for the per-IP run quota; null without an address. */
export type ConnectionInfo = { role: ConnectionRole; ip: string | null };

export const STATE_CAPS = { checks: 40, messages: 50, approvals: 5, timeline: 100 } as const;

export const EMPTY_STATE: IncidentState = {
  id: "",
  target: "",
  origin: "chat",
  status: "investigating",
  category: null,
  confidence: null,
  mode: "ai",
  activeRunId: null,
  findings: null,
  checks: [],
  messages: [],
  approvals: [],
  timeline: [],
  monitor: null,
  hasPostmortem: false,
};
