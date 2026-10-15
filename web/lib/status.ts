import type { CheckView, IncidentStatus } from "../../worker/agent/state";
import type { CardState } from "./approval";

/** One colour per meaning, across the whole app (TDD §12.2). Classes live in `styles.css` (`.tone-*`). */
export type Tone = "orange" | "purple" | "green" | "red" | "yellow" | "grey";

/** Orange = in progress, purple = waiting on you, green = good, red = broken, yellow = check errored, grey = quiet. */
export const INCIDENT_TONE: Record<IncidentStatus, Tone> = {
  investigating: "orange",
  awaiting_approval: "purple",
  mitigated: "grey",
  resolved: "green",
};

export const CHECK_TONE: Record<CheckView["status"], Tone> = {
  pending: "grey",
  running: "orange",
  pass: "green",
  fail: "red",
  error: "yellow",
  unavailable: "grey",
};

export type WatchState = "incident_open" | "fail" | "pass" | "unchecked";

export const WATCH_TONE: Record<WatchState, Tone> = {
  incident_open: "orange",
  fail: "red",
  pass: "green",
  unchecked: "grey",
};

export const APPROVAL_TONE: Record<CardState["tone"], Tone> = {
  waiting: "purple",
  working: "orange",
  good: "green",
  bad: "red",
  closed: "grey",
};
