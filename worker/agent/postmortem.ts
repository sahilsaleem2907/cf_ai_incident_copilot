import { CATEGORY_LABEL, type Findings } from "../diagnosis/categories";
import { normalizeRefs } from "../llm/citations";
import type { Origin, Scalar } from "./state";

/**
 * Postmortem (TDD §8.7, WP-22; user decision "facts by code, story by AI"). The impact window, detection and
 * timeline come straight from the incident's records, so times can't be made up. The AI (or the template) writes
 * the summary, root cause, resolution and follow-ups. Pure, so it's unit-tested without an agent.
 */
export type PostmortemInput = {
  target: string;
  origin: Origin;
  /** The question that opened the incident (or the watch's "Scheduled check failed for …"). */
  question: string;
  /** The full timeline, oldest first. */
  timeline: { ts: number; type: string; detail: Record<string, Scalar> }[];
  /** The latest run's findings. */
  findings: Findings | null;
  approvals: { id: string; title: string; status: string; outcome: string | null }[];
};

export type Facts = { host: string; impact: string[]; detection: string; timeline: string[]; resolvedBy: "action" | "checks" | "hand" | "healthy" | null; durationMs: number | null };

export const PROSE_SECTIONS = ["summary", "rootCause", "resolution", "followUps"] as const;
export type Prose = Record<(typeof PROSE_SECTIONS)[number], string>;
const HEADINGS: Prose = { summary: "Summary", rootCause: "Root cause", resolution: "Resolution", followUps: "Follow-ups" };

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (ts: number) => new Date(ts).toISOString();
const time = (ts: number) => iso(ts).slice(11, 19);
const stamp = (ts: number) => `${iso(ts).slice(0, 10)} ${time(ts)} UTC`;

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${pad(s % 60)} s`;
  return `${Math.floor(m / 60)} h ${pad(m % 60)} min`;
}

const str = (v: Scalar | undefined) => (v === null || v === undefined ? "" : String(v));

/** The facts sections. Monitor and watch checks in a row collapse into one line with a count. */
export function postmortemFacts(p: PostmortemInput): Facts {
  const host = URL.canParse(p.target) ? new URL(p.target).hostname : p.target;
  const titles = new Map(p.approvals.map((a) => [a.id, a.title]));
  const opened = p.timeline.find((t) => t.type === "opened")?.ts ?? p.timeline[0]?.ts ?? null;
  const resolvedEvent = p.timeline.filter((t) => t.type === "status" && t.detail.to === "resolved").at(-1);
  const firstFindings = p.timeline.find((t) => t.type === "findings");

  const lines: string[] = [];
  type Group = { type: string; ts: number; n: number; passed: number };
  let group: Group | null = null as Group | null;
  const flush = () => {
    if (!group) return;
    const what = group.type === "monitor_tick" ? "monitor check" : "watch check";
    lines.push(`- ${time(group.ts)} ${group.n} ${what}${group.n > 1 ? "s" : ""}, ${group.passed} passed`);
    group = null;
  };
  for (const t of p.timeline) {
    if (t.type === "monitor_tick" || t.type === "watch_check") {
      if (group?.type !== t.type) flush();
      const g: Group = (group ??= { type: t.type, ts: t.ts, n: 0, passed: 0 });
      g.n++;
      if (t.detail.pass === true) g.passed++;
      continue;
    }
    const text = describe(t, titles, p);
    if (!text) continue;
    flush();
    lines.push(`- ${time(t.ts)} ${text}`);
  }
  flush();

  const durationMs = opened !== null && resolvedEvent ? resolvedEvent.ts - opened : null;
  const impact = [
    `- Start: ${opened !== null ? stamp(opened) : "unknown"} (incident opened)`,
    `- End: ${resolvedEvent ? `${stamp(resolvedEvent.ts)} (resolved)` : "not resolved yet"}`,
    ...(durationMs !== null ? [`- Duration: ${duration(durationMs)}`] : []),
  ];
  const how = p.origin === "watch" ? `A scheduled watch check failed for ${p.target}, and a re-check confirmed it.` : `Reported in chat: “${p.question.trim().slice(0, 300)}”.`;
  const firstDiagnosis = firstFindings && opened !== null ? ` The first diagnosis came ${duration(firstFindings.ts - opened)} later.` : "";
  const reason = str(resolvedEvent?.detail.reason);
  const resolvedBy = !resolvedEvent
    ? null
    : reason === "resolved by hand"
      ? "hand"
      : reason === "healthy on first check"
        ? "healthy"
        : p.approvals.some((a) => a.status === "approved")
          ? "action"
          : "checks";

  return { host, impact, detection: `${how}${firstDiagnosis}`, timeline: lines, resolvedBy, durationMs };
}

function describe(t: PostmortemInput["timeline"][number], titles: Map<string, string>, p: PostmortemInput): string | null {
  const d = t.detail;
  const title = () => titles.get(str(d.approvalId)) ?? str(d.actionId).replace(/_/g, " ");
  switch (t.type) {
    case "opened":
      return p.origin === "watch" ? `Incident opened by a failed watch check on ${str(d.target)}` : `Incident opened from chat for ${str(d.target)}`;
    case "run_started":
      return d.kind === "followup" ? "Follow-up question asked" : null;
    case "findings": {
      const category = CATEGORY_LABEL[str(d.category) as keyof typeof CATEGORY_LABEL] ?? str(d.category);
      return `Diagnosis: ${category} (${str(d.confidence)} confidence${d.mode === "rule_based" ? ", rule-based" : ""})`;
    }
    case "approval":
      switch (d.status) {
        case "pending":
          return `Proposed: ${title()}`;
        case "approved":
          return `Approved: ${title()}`;
        case "rejected":
          return `Rejected: ${title()}`;
        case "expired":
          return `Expired without a decision: ${title()}`;
        case "superseded":
          return `Replaced by a newer proposal: ${title()}`;
        default:
          return null;
      }
    case "action_executed":
      return d.ok ? `Action ran: ${title()}` : `Action failed: ${title()}`;
    case "verified":
      return d.pass ? `Verified after the action: HTTP ${str(d.status)} in ${str(d.ms)} ms` : "Re-check after the action still failing";
    case "status":
      return `Status ${str(d.from).replace(/_/g, " ")} → ${str(d.to).replace(/_/g, " ")}${d.reason ? ` (${str(d.reason)})` : ""}`;
    default:
      return null;
  }
}

/** The prose without an AI: from the findings, the approvals and how the incident ended. */
export function templateProse(p: PostmortemInput, facts: Facts): Prose {
  const f = p.findings;
  const category = f ? CATEGORY_LABEL[f.category] : "an unknown problem";
  const opened = p.origin === "watch" ? "a failed watch check" : "a chat report";
  const took = facts.durationMs !== null ? ` and was resolved after ${duration(facts.durationMs)}` : "";
  const actions = p.approvals.filter((a) => a.status === "approved");
  const resolution =
    facts.resolvedBy === "hand"
      ? "The incident was resolved by hand."
      : facts.resolvedBy === "healthy"
        ? "Nothing needed fixing: the first check found the endpoint healthy."
      : actions.length
        ? actions.map((a) => `${a.title} (approved). ${a.outcome ?? ""}`.trim()).join("\n\n")
        : facts.resolvedBy === "checks"
          ? "The endpoint recovered: 3 checks in a row passed."
          : "No action was taken.";
  return {
    summary: `${facts.host}: ${f ? `${category} (${f.confidence} confidence)` : category}. The incident was opened from ${opened}${took}.`,
    rootCause: f?.cause ?? "No diagnosis was recorded.",
    resolution,
    followUps: (f?.next_steps.length ? f.next_steps : ["Review the evidence and decide whether a follow-up is needed."]).map((s) => `- ${s}`).join("\n"),
  };
}

const HEADING = /^#{1,3}\s*(.+?)\s*:?\s*$/;
const KEY_OF: [RegExp, keyof Prose][] = [
  [/^summary$/i, "summary"],
  [/^root\s*cause/i, "rootCause"],
  [/^resolution/i, "resolution"],
  [/^follow[\s-]*ups?|^action items/i, "followUps"],
];

/**
 * The AI's four `##` sections. Full-width `【id】` citations are normalised and unknown evidence IDs removed; a
 * section that's missing or empty comes from `fallback`, so the result always has all four.
 */
export function parseProse(text: string, knownIds: readonly string[], fallback: Prose): { prose: Prose; fromAi: number } {
  const known = new Set(knownIds);
  const clean = normalizeRefs(text).replace(/\[([a-z]+-\d+)\]/g, (m, id: string) => (known.has(id) ? m : ""));
  const found: Partial<Prose> = {};
  let key: keyof Prose | null = null;
  let body: string[] = [];
  const close = () => {
    if (key && body.join("\n").trim()) found[key] ??= body.join("\n").trim();
    body = [];
  };
  for (const line of clean.split("\n")) {
    const h = HEADING.exec(line.trim());
    const k = h ? KEY_OF.find(([re]) => re.test(h[1]!.replace(/\*\*/g, "").replace(/:$/, "").trim()))?.[1] : undefined;
    if (h) {
      close();
      key = k ?? null;
      continue;
    }
    if (key) body.push(line);
  }
  close();
  const prose = Object.fromEntries(PROSE_SECTIONS.map((k) => [k, found[k] ?? fallback[k]])) as Prose;
  return { prose, fromAi: PROSE_SECTIONS.filter((k) => found[k]).length };
}

/** The root cause always cites its evidence: the findings' IDs are added when the text has no known one. */
export function citeRootCause(prose: Prose, evidence: readonly string[], knownIds: readonly string[]): Prose {
  const known = new Set(knownIds);
  if ([...prose.rootCause.matchAll(/\[([a-z]+-\d+)\]/g)].some((m) => known.has(m[1]!))) return prose;
  const ids = evidence.filter((id) => known.has(id));
  if (!ids.length) return prose;
  return { ...prose, rootCause: `${prose.rootCause.trim().replace(/\.$/, "")} ${ids.map((id) => `[${id}]`).join(" ")}.` };
}

export function renderPostmortem(facts: Facts, prose: Prose): string {
  return [
    `# Postmortem: ${facts.host}`,
    `## ${HEADINGS.summary}\n\n${prose.summary}`,
    `## Impact window\n\n${facts.impact.join("\n")}`,
    `## Detection\n\n${facts.detection}`,
    `## Timeline (UTC)\n\n${facts.timeline.length ? facts.timeline.join("\n") : "- No events recorded."}`,
    `## ${HEADINGS.rootCause}\n\n${prose.rootCause}`,
    `## ${HEADINGS.resolution}\n\n${prose.resolution}`,
    `## ${HEADINGS.followUps}\n\n${prose.followUps}`,
  ].join("\n\n");
}

/** The facts as plain text for the AI prompt. */
export function factsText(facts: Facts): string {
  return [`Impact window:\n${facts.impact.join("\n")}`, `Detection: ${facts.detection}`, `Timeline (UTC):\n${facts.timeline.join("\n")}`].join("\n\n");
}
