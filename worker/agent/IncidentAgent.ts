import { Agent, callable, getCurrentAgent, type Connection, type ConnectionContext } from "agents";
import { ACTION_TITLES, execute, isOwnDemo, pickAction, type ActionOutcome } from "../actions/catalog";
import type { ActionId, Findings } from "../diagnosis/categories";
import { classify } from "../diagnosis/classify";
import { renderTemplate } from "../diagnosis/template";
import { workspaceFromCookieHeader } from "../lib/cookie";
import { newId } from "../lib/ids";
import { llmDeps } from "../llm/client";
import { LlmUnavailable } from "../llm/models";
import { narrationSystem, narrationUser, postmortemSystem, postmortemUser, type EvidenceLine } from "../llm/prompts";
import { streamLlm } from "../llm/stream";
import { budgetMode, d1Usage } from "../llm/usage";
import { salvageFindings } from "../loop/findings";
import { finalizeNarration, NARRATION_MAX_TOKENS, type NarrationOutcome } from "../loop/narrate";
import type { FinishStats } from "../loop/plan";
import { ipKey, takeRun } from "../safety/quota";
import { devAllowOrigin } from "../safety/ssrf";
import type { DnsRaw } from "../tools/dns";
import { quickCheck, type QuickCheckResult } from "../tools/quickcheck";
import { evidenceId, toolLabel } from "../tools/registry";
import { canWatch, releaseIncident } from "../watch/store";
import { startNotify } from "../workflows/notify";
import type { ToolName, ToolResult } from "../tools/types";
import { MONITOR_MAX_TICKS, MONITOR_TICK_S, tick } from "./monitor";
import { citeRootCause, factsText, parseProse, postmortemFacts, renderPostmortem, templateProse, type PostmortemInput, type Prose } from "./postmortem";
import { SCHEMA } from "./schema.sql";
import {
  EMPTY_STATE,
  STATE_CAPS,
  type ApprovalStatus,
  type ConnectionRole,
  type ConnectionInfo,
  type IncidentState,
  type IncidentStatus,
  type Json,
  type Origin,
  type Scalar,
  type RunKind,
  type RunMode,
  type RunStatus,
  type StreamFrame,
} from "./state";
import { assertTransition } from "./transitions";

type IncidentRow = {
  id: string;
  workspace_id: string;
  target: string;
  origin: Origin;
  status: IncidentStatus;
  category: string | null;
  confidence: string | null;
  mode: RunMode;
  watch_id: string | null;
  unread: number;
  created_at: number;
  updated_at: number;
};
type RunRow = { id: string; seq: number; kind: RunKind; question: string; status: RunStatus; mode: RunMode; findings_json: string | null };
type CheckRow = {
  evidence_id: string;
  run_id: string;
  tool: ToolName;
  status: string;
  summary: string;
  digest: string | null;
  raw_json: string | null;
  started_at: number;
  finished_at: number | null;
};

type ApprovalRow = {
  id: string;
  run_id: string;
  action_id: ActionId;
  status: ApprovalStatus;
  workflow_id: string | null;
  created_at: number;
  decided_at: number | null;
  outcome_json: string | null;
};
type MonitorRow = { kind: "post_action" | "burst"; ticks_left: number; consecutive_passes: number; schedule_id: string | null };

/** `mode: "rule_based"` runs the first diagnosis without the LLM (the deploy smoke test, TDD §15). */
export type InitParams = { workspaceId: string; target: string; origin: Origin; message?: string; watchId?: string; mode?: RunMode };
export type PlannedCall = { tool: ToolName; args: unknown };
/** What a Workflow run needs to plan (TDD §7.2). Evidence is digests only, never `raw`. */
export type RunContext = {
  incidentId: string;
  runId: string;
  target: string;
  question: string;
  kind: RunKind;
  mode: RunMode;
  evidence: EvidenceLine[];
  scope: { host: string; cnameTargets: string[] };
  /** The target is this workspace's demo page: the planning prompt says so (TDD §7.6). */
  isDemo: boolean;
};
export type Proposal = { approvalId: string | null; actionId: ActionId | null };
export type Decision = "rejected" | "expired" | "failed";
export type VerifyResult = { pass: boolean; text: string };

/** The four postmortem sections are short; narration-sized headroom. */
const POSTMORTEM_MAX_TOKENS = 1200;
export const POSTMORTEM_WRITTEN_TEXT = "Postmortem written. Open it with the Postmortem button.";

/** How long a card waits for a decision (FR-21). */
export const APPROVAL_TIMEOUT = "24 hours";

/** Prior evidence handed to a planning turn: the most recent checks only, to keep prompts small. */
const CONTEXT_CHECKS = 10;
const MAX_MESSAGE = 2000;

/**
 * One incident (TDD §3): SQL tables, synced state, owner/viewer roles (D8), the state machine (§10),
 * streamed narration (D4), the D1 index, approvals with their actions and the post-action monitor (WP-12).
 * Watch reports (WP-18) and postmortems (WP-22) are added by their WPs.
 */
export class IncidentAgent extends Agent<Cloudflare.Env, IncidentState> {
  override initialState = EMPTY_STATE;
  /** A postmortem being written: a second click waits for it instead of paying again. */
  private postmortemInFlight: Promise<string> | null = null;

  override async onStart() {
    for (const statement of SCHEMA) this.ctx.storage.sql.exec(statement);
    // Reconcile the D1 index: the DO is the source of truth (TDD §6.1).
    if (this.incident()) await this.upsertIndex();
  }

  // ---- roles (D8) ----

  private roleFor(ctx: ConnectionContext): ConnectionRole {
    const ws = workspaceFromCookieHeader(ctx.request.headers.get("cookie"));
    const incident = this.incident();
    return incident && ws === incident.workspace_id ? "owner" : "viewer";
  }

  override shouldConnectionBeReadonly(_connection: Connection, ctx: ConnectionContext): boolean {
    return this.roleFor(ctx) !== "owner";
  }

  override async onConnect(connection: Connection, ctx: ConnectionContext) {
    if (!this.incident()) {
      connection.close(4404, "Unknown incident");
      return;
    }
    connection.setState({ role: this.roleFor(ctx), ip: await ipKey(ctx.request.headers.get("CF-Connecting-IP")) } satisfies ConnectionInfo);
  }

  /** Only the server writes state; clients use callables. */
  override validateStateChange(_next: unknown, source: Connection | "server") {
    if (source !== "server") throw new Error("State is read-only for clients.");
  }

  /** Server-side RPC has no connection and is trusted; WebSocket callers must be the owner. */
  private requireOwner() {
    const { connection } = getCurrentAgent();
    if (!connection) return;
    if ((connection.state as ConnectionInfo | null)?.role !== "owner") throw new Error("forbidden: this incident link is view-only");
  }

  // ---- RPC: Worker and Workflow (TDD §7.2) ----

  /** Idempotent: a retried create (Worker or WatchWorkflow step) returns the existing incident's run. */
  async init(p: InitParams): Promise<{ runId: string | null }> {
    if (this.incident()) return { runId: this.activeRunId() };
    const now = Date.now();
    this.sql`INSERT INTO incident (id, workspace_id, target, origin, status, watch_id, created_at, updated_at)
      VALUES (${this.name}, ${p.workspaceId}, ${p.target}, ${p.origin}, 'investigating', ${p.watchId ?? null}, ${now}, ${now})`;
    this.event("opened", { origin: p.origin, target: p.target });
    const question = p.message ?? `Scheduled check failed for ${p.target}`;
    const runId = await this.startRun(question, "initial", p.message ? "user" : "system", p.mode);
    return { runId };
  }

  /** One planning run at a time (D13). The check and insert run without an await in between. */
  async startRun(question: string, kind: RunKind, role: "user" | "system" = "user", requested: RunMode = "ai"): Promise<string> {
    // Budget guard (TDD §11): read before the check-and-insert below, which must not await.
    const mode = requested === "ai" ? await budgetMode(d1Usage(this.env.DB)) : requested;
    if (!this.incident()) throw new Error("not_initialized");
    if (this.activeRunId()) throw new Error("run_active");
    const seq = (this.sql<{ seq: number | null }>`SELECT MAX(seq) AS seq FROM runs`[0]?.seq ?? 0) + 1;
    const runId = `run-${seq}`;
    const now = Date.now();
    this.sql`INSERT INTO runs (id, seq, kind, question, status, mode, started_at) VALUES (${runId}, ${seq}, ${kind}, ${question}, 'running', ${mode}, ${now})`;
    this.addMessage(runId, role, question);
    this.event("run_started", { runId, kind });
    this.touch();
    this.syncState();
    await this.upsertIndex();
    // Test seam: the integration tests drive some runs by hand (vitest.config.ts sets it); unset everywhere else.
    if ((this.env as { DIAGNOSIS_AUTOSTART?: string }).DIAGNOSIS_AUTOSTART !== "off") await this.launchRun(runId);
    return runId;
  }

  /**
   * Starts the run's DiagnosisWorkflow (TDD §8.1) with ID `diag-<incidentId>-<seq>`. Idempotent. If the
   * Workflow can't start, the run ends as `failed` with a note, so the composer isn't left disabled.
   */
  async launchRun(runId: string): Promise<string | null> {
    const run = this.mustRun(runId);
    const existing = this.sql<{ workflow_id: string | null }>`SELECT workflow_id FROM runs WHERE id = ${runId}`[0]?.workflow_id;
    if (existing) return existing;
    if (run.status !== "running") return null;
    const id = `diag-${this.name}-${run.seq}`;
    try {
      await this.runWorkflow("DIAGNOSIS_WORKFLOW", { incidentId: this.name, runId }, { id });
      this.sql`UPDATE runs SET workflow_id = ${id} WHERE id = ${runId}`;
      return id;
    } catch (e) {
      console.error("could not start the diagnosis workflow", (e as Error).message);
      this.addMessage(runId, "system", "The diagnosis couldn't start. Please try again in a moment.");
      await this.finishRun(runId, "failed");
      return null;
    }
  }

  getRunContext(runId: string): RunContext {
    const incident = this.mustIncident();
    const run = this.mustRun(runId);
    const rows = this.sql<CheckRow>`SELECT * FROM checks WHERE finished_at IS NOT NULL ORDER BY rowid DESC LIMIT ${CONTEXT_CHECKS}`.reverse();
    const cnameTargets = rows.flatMap((r) => (r.tool === "dns_lookup" && r.raw_json ? ((JSON.parse(r.raw_json) as DnsRaw).cnameTargets ?? []) : []));
    return {
      incidentId: incident.id,
      runId,
      target: incident.target,
      question: run.question,
      kind: run.kind,
      // Set when the run starts: rule_based for the smoke test, and when the neuron budget guard trips.
      mode: run.mode,
      evidence: rows.map(toLine),
      scope: { host: new URL(incident.target).hostname, cnameTargets: [...new Set(cnameTargets)] },
      isDemo: isOwnDemo(incident.target, incident.workspace_id, this.env.DEMO_BASE_URL),
    };
  }

  /** Allocates evidence IDs for one planning turn. A retried step gets the same IDs back. */
  addPendingChecks(runId: string, turn: number, calls: PlannedCall[]): string[] {
    this.mustRun(runId);
    const existing = this.sql<{ evidence_id: string }>`SELECT evidence_id FROM checks WHERE run_id = ${runId} AND turn = ${turn} ORDER BY seq`;
    if (existing.length) return existing.map((r) => r.evidence_id);
    const now = Date.now();
    const ids = calls.map((call, seq) => {
      const n = (this.sql<{ n: number }>`SELECT COUNT(*) AS n FROM checks WHERE tool = ${call.tool}`[0]?.n ?? 0) + 1;
      const id = evidenceId(call.tool, n);
      this.sql`INSERT INTO checks (evidence_id, run_id, turn, seq, tool, args_json, status, started_at)
        VALUES (${id}, ${runId}, ${turn}, ${seq}, ${call.tool}, ${JSON.stringify(call.args ?? {})}, 'pending', ${now})`;
      return id;
    });
    this.syncState();
    return ids;
  }

  /** Stores a finished check. An upsert, so a retried tool step is harmless. */
  recordCheck(id: string, result: ToolResult): void {
    if (!this.sql`SELECT 1 FROM checks WHERE evidence_id = ${id}`.length) throw new Error(`unknown evidence id ${id}`);
    this.sql`UPDATE checks SET status = ${result.status}, summary = ${result.summary}, digest = ${result.digest},
      raw_json = ${JSON.stringify(result.raw ?? null)}, finished_at = ${Date.now()} WHERE evidence_id = ${id}`;
    this.syncState();
  }

  /**
   * Rule-based findings over every stored check (raw evidence stays here), keeping whatever the model's
   * last `submit_findings` got right (TDD §8.2 "Limits keep progress").
   */
  ruleFindings(runId: string, modelArgs: unknown): Findings {
    this.mustRun(runId);
    const results = this.sql<CheckRow>`SELECT * FROM checks WHERE finished_at IS NOT NULL ORDER BY rowid`.map(toResult);
    return salvageFindings(modelArgs, classify(results), results.map((r) => r.evidenceId)).findings;
  }

  async setFindings(runId: string, findings: Findings, mode: RunMode = "ai"): Promise<void> {
    const run = this.mustRun(runId);
    const incident = this.mustIncident();
    this.sql`UPDATE runs SET findings_json = ${JSON.stringify(findings)}, mode = ${mode} WHERE id = ${runId}`;
    this.sql`UPDATE incident SET category = ${findings.category}, confidence = ${findings.confidence}, mode = ${mode} WHERE id = ${incident.id}`;
    this.event("findings", { runId, category: findings.category, confidence: findings.confidence, mode });
    // A chat incident whose first check is healthy is resolved right away (TDD §10).
    if (findings.category === "healthy" && run.seq === 1 && incident.origin === "chat" && incident.status === "investigating") {
      await this.transition("resolved", "healthy on first check");
      return;
    }
    this.touch();
    this.syncState();
    await this.upsertIndex();
  }

  /**
   * Streams the diagnosis (D4) and stores the final text. Idempotent per run. Never fails the run:
   * junk or missing output falls back to the rule template, and a well-formed answer that was cut short
   * is kept with a note (TDD §8.2 "Limits keep progress").
   */
  async narrate(runId: string): Promise<{ messageId: string; source: NarrationOutcome["source"] | "existing" }> {
    const messageId = `narr-${runId}`;
    if (this.sql`SELECT 1 FROM messages WHERE id = ${messageId}`.length) return { messageId, source: "existing" };
    const run = this.mustRun(runId);
    const findings = run.findings_json ? (JSON.parse(run.findings_json) as Findings) : null;
    const results = this.resultsFor(findings?.evidence ?? [], runId);
    const knownIds = this.sql<{ evidence_id: string }>`SELECT evidence_id FROM checks`.map((r) => r.evidence_id);
    const template = () => (findings ? renderTemplate(findings, results) : "No findings were recorded for this run.");
    const cause = findings ? { text: findings.cause, evidence: findings.evidence } : undefined;

    let outcome: NarrationOutcome;
    if (!findings || run.mode === "rule_based") {
      outcome = { text: template(), source: "template" };
    } else {
      this.frame({ type: "stream_start", messageId });
      try {
        const r = await streamLlm(
          llmDeps(this.env),
          { system: narrationSystem(), messages: narrationUser({ question: run.question, findings, evidence: results.map(toLine) }), maxTokens: NARRATION_MAX_TOKENS },
          (text) => this.frame({ type: "delta", messageId, text }),
        );
        outcome = finalizeNarration({ text: r.text, truncated: r.truncated, knownIds, template, cause });
      } catch (e) {
        console.warn("narration failed", (e as Error).message);
        outcome = finalizeNarration({ partial: e instanceof LlmUnavailable ? e.partial : undefined, knownIds, template, cause });
      }
      this.frame({ type: "stream_end", messageId });
    }

    this.sql`INSERT OR IGNORE INTO messages (id, run_id, role, content, evidence_refs_json, created_at)
      VALUES (${messageId}, ${runId}, 'assistant', ${outcome.text}, ${JSON.stringify(findings?.evidence ?? [])}, ${Date.now()})`;
    this.event("narrated", { runId, source: outcome.source });
    this.sql`UPDATE incident SET unread = 1 WHERE id = ${this.name}`;
    this.touch();
    this.syncState();
    await this.upsertIndex();
    return { messageId, source: outcome.source };
  }

  // ---- approvals and actions (TDD §7.6, §8.2–§8.4) ----

  /**
   * Shows at most one approval card for the run. Idempotent per run. D13: the same action as a pending card is a
   * duplicate (no new card, the Workflow doesn't wait); a different one supersedes the pending card.
   */
  async proposeAction(runId: string, workflowId: string): Promise<Proposal> {
    const existing = this.sql<ApprovalRow>`SELECT * FROM approvals WHERE run_id = ${runId}`[0];
    if (existing) return { approvalId: existing.id, actionId: existing.action_id };
    const run = this.mustRun(runId);
    const incident = this.mustIncident();
    if (!run.findings_json) return { approvalId: null, actionId: null };
    const findings = JSON.parse(run.findings_json) as Findings;
    const actionId = pickAction(findings, {
      target: incident.target,
      workspaceId: incident.workspace_id,
      demoBaseUrl: this.env.DEMO_BASE_URL,
      category: findings.category,
      status: incident.status,
      watchable: await this.watchable(incident),
      hasPostmortem: this.storedPostmortem() !== null,
    });
    if (!actionId) return { approvalId: null, actionId: null };

    const pending = this.sql<ApprovalRow>`SELECT * FROM approvals WHERE status = 'pending'`;
    if (pending.some((a) => a.action_id === actionId)) {
      this.event("proposal_deduped", { runId, actionId });
      this.syncState();
      return { approvalId: null, actionId };
    }
    const now = Date.now();
    for (const old of pending) {
      this.sql`UPDATE approvals SET status = 'superseded', decided_at = ${now} WHERE id = ${old.id}`;
      this.event("approval", { approvalId: old.id, status: "superseded" });
    }
    const approvalId = newId();
    this.sql`INSERT INTO approvals (id, run_id, action_id, status, workflow_id, created_at)
      VALUES (${approvalId}, ${runId}, ${actionId}, 'pending', ${workflowId}, ${now})`;
    this.event("approval", { approvalId, status: "pending", actionId });
    if (incident.status === "investigating") await this.transition("awaiting_approval", "action proposed");
    else {
      this.touch();
      this.syncState();
    }
    // After the new card is stored, so a slow call can't leave the incident without one.
    for (const old of pending) await this.tellWorkflow(old, false, "superseded");
    return { approvalId, actionId };
  }

  /** The Workflow's outcome for a card that didn't run (rejected, expired) or whose action failed. First decision wins. */
  async recordApprovalOutcome(approvalId: string, decision: Decision, detail?: string): Promise<void> {
    const a = this.mustApproval(approvalId);
    const now = Date.now();
    if (decision === "failed") {
      if (a.status !== "approved") return;
      this.setOutcome(a.id, { ok: false, text: `The action failed: ${detail ?? "unknown error"}. Nothing was changed.` });
    } else if (a.status === "pending" || (decision === "expired" && a.status === "approved" && !a.outcome_json)) {
      // An approve that raced the timeout never ran, so the card says expired.
      const text = decision === "expired" ? "No action taken: the approval expired after 24 hours." : "Rejected: no action taken.";
      this.sql`UPDATE approvals SET status = ${decision}, decided_at = ${now}, outcome_json = ${JSON.stringify({ ok: false, text })} WHERE id = ${a.id}`;
      this.event("approval", { approvalId: a.id, status: decision });
    } else return;
    await this.leaveAwaitingApproval(decision === "failed" ? "action failed" : `approval ${decision}`);
  }

  /** Runs an approved action (FR-20). Idempotent, so a retried Workflow step is harmless. */
  async executeAction(approvalId: string): Promise<ActionOutcome> {
    const a = this.mustApproval(approvalId);
    if (a.status !== "approved") throw new Error(`approval ${approvalId} is ${a.status}`);
    const incident = this.mustIncident();
    // A postmortem is written here, by the agent; the card was approved, so it isn't charged to the run quota.
    const out =
      a.action_id === "generate_postmortem"
        ? (await this.writePostmortem((await budgetMode(d1Usage(this.env.DB))) === "ai"), { ok: true, text: POSTMORTEM_WRITTEN_TEXT })
        : await execute(a.action_id, { env: this.env, workspaceId: incident.workspace_id, incidentId: incident.id, target: incident.target });
    // The watch now reports to this incident (cron → reportWatchCheck), and resolving it frees the watch.
    if (out.watchId) this.sql`UPDATE incident SET watch_id = ${out.watchId} WHERE id = ${incident.id}`;
    this.setOutcome(a.id, { ok: out.ok, text: out.text });
    this.event("action_executed", { approvalId, actionId: a.action_id, ok: out.ok });
    this.touch();
    this.syncState();
    return out;
  }

  /**
   * Re-checks the target after an action (FR-23). The quick check runs here, not in the Workflow, so its fetches
   * don't use the run's subrequest budget. A pass → mitigated and the monitor starts; a fail → investigating.
   */
  async afterAction(runId: string, approvalId: string): Promise<VerifyResult> {
    this.mustRun(runId);
    const a = this.mustApproval(approvalId);
    const prior = a.outcome_json ? (JSON.parse(a.outcome_json) as ActionOutcome & { verified?: boolean; done?: boolean }) : null;
    if (prior?.verified !== undefined) return { pass: prior.verified, text: prior.text };
    if (prior?.done) return { pass: true, text: prior.text };
    // Watching fixes nothing, so there's nothing to re-check: the incident goes back to investigating, and the
    // watch's passing checks resolve it later (reportWatchCheck). A postmortem has nothing to re-check either.
    if (a.action_id === "add_to_watchlist" || a.action_id === "generate_postmortem") {
      const text = prior?.text ?? (a.action_id === "add_to_watchlist" ? "Added to the watchlist." : POSTMORTEM_WRITTEN_TEXT);
      this.sql`UPDATE approvals SET outcome_json = ${JSON.stringify({ ok: true, text, done: true })} WHERE id = ${a.id}`;
      await this.leaveAwaitingApproval(a.action_id === "add_to_watchlist" ? "added to the watchlist" : "postmortem written");
      return { pass: true, text };
    }

    const v = await this.quickCheck();
    const text = `${prior?.text ? `${prior.text} ` : ""}${verifyText(v)}`;
    this.sql`UPDATE approvals SET outcome_json = ${JSON.stringify({ ok: v.pass, text, verified: v.pass })} WHERE id = ${a.id}`;
    this.event("verified", { approvalId, pass: v.pass, status: v.status, ms: v.totalMs });
    const incident = this.mustIncident();
    if (incident.status === "awaiting_approval") {
      if (v.pass) {
        await this.transition("mitigated", "verified after the action");
        await this.startMonitor(1);
      } else await this.leaveAwaitingApproval("verify failed after the action");
    } else this.syncState();
    return { pass: v.pass, text };
  }

  /** One monitor tick (D11, TDD §8.4), run by the agent scheduler. Also callable over RPC, which the tests use. */
  async monitorTick(): Promise<void> {
    const m = this.sql<MonitorRow>`SELECT * FROM monitor WHERE id = 1`[0];
    if (!m) return;
    const incident = this.mustIncident();
    const v = await this.quickCheck();
    const r = tick({ ticksLeft: m.ticks_left, passes: m.consecutive_passes }, incident.status, v.pass);
    this.event("monitor_tick", { pass: v.pass, passes: v.pass ? m.consecutive_passes + 1 : 0, ticksLeft: m.ticks_left - 1 });
    if (r.monitor) {
      const next = await this.schedule(MONITOR_TICK_S, "monitorTick");
      this.sql`UPDATE monitor SET ticks_left = ${r.monitor.ticksLeft}, consecutive_passes = ${r.monitor.passes}, schedule_id = ${next.id} WHERE id = 1`;
    } else {
      this.sql`DELETE FROM monitor WHERE id = 1`;
      if (r.to !== "resolved") this.event("monitor_ended", { reason: "out of ticks" });
    }
    if (r.to) {
      // Automatic changes are new activity for the sidebar's unread dot (FR-50); the user's own aren't.
      this.sql`UPDATE incident SET unread = 1 WHERE id = ${this.name}`;
      await this.transition(r.to, r.to === "resolved" ? "3 passing checks in a row" : v.pass ? "recovered" : "failing again");
    }
    else {
      this.touch();
      this.syncState();
    }
  }

  /**
   * A cron check of this incident's watch (TDD §8.4–§8.5). Passes feed the same rules as the monitor: a pass while
   * investigating → mitigated (recovered without an action), 3 in a row → resolved, a failure reopens a mitigated
   * incident. While the post-action monitor runs it decides, since it checks every 15 s; a pending card is left alone.
   */
  async reportWatchCheck(pass: boolean, consecutivePasses: number, summary: string): Promise<void> {
    const incident = this.incident();
    if (!incident || incident.status === "resolved") return;
    this.event("watch_check", { pass, passes: consecutivePasses, summary });
    const monitorRunning = this.sql`SELECT 1 FROM monitor WHERE id = 1`.length > 0;
    const r = monitorRunning ? { to: null } : tick({ ticksLeft: 2, passes: Math.max(0, consecutivePasses - 1) }, incident.status, pass);
    if (r.to) {
      this.sql`UPDATE incident SET unread = 1 WHERE id = ${this.name}`;
      await this.transition(r.to, r.to === "resolved" ? "3 passing watch checks in a row" : pass ? "watch check passed" : "watch check failing again");
    }
    else {
      this.touch();
      this.syncState();
    }
  }

  /** Ends a run and records why (TDD §8.2). Only the first call counts. */
  async finishRun(runId: string, status: Exclude<RunStatus, "running">, stats: Partial<FinishStats> = {}): Promise<void> {
    const run = this.mustRun(runId);
    if (run.status !== "running") return;
    const now = Date.now();
    this.sql`UPDATE runs SET status = ${status}, finished_at = ${now}, tool_calls = ${stats.toolCalls ?? 0},
      llm_turns = ${stats.llmTurns ?? 0} WHERE id = ${runId}`;
    // Checks planned but never run (the run stopped first) shouldn't spin forever in the UI.
    this.sql`UPDATE checks SET status = 'unavailable', summary = 'Not run: the run stopped before this check.', finished_at = ${now}
      WHERE run_id = ${runId} AND finished_at IS NULL`;
    // WP-20: who made the findings, for the eval. Only a Workflow run passes it.
    this.event("run_finished", { runId, status, ...(stats.source ? { source: stats.source, fallbackTurns: stats.fallbackTurns ?? 0 } : {}) });
    this.touch();
    this.syncState();
    await this.upsertIndex();
  }

  getSnapshot(): IncidentState {
    return this.state;
  }

  // ---- callables (WebSocket); registered below the class ----

  async sendMessage(text: unknown): Promise<{ runId: string }> {
    this.requireOwner();
    if (typeof text !== "string" || !text.trim()) throw new Error("empty_message");
    // Checked before the quota so a send that can't start isn't counted; startRun checks again.
    if (this.activeRunId()) throw new Error("run_active");
    const ip = (getCurrentAgent().connection?.state as ConnectionInfo | null)?.ip ?? null;
    const quota = await takeRun(this.env, { workspaceId: this.mustIncident().workspace_id, ip });
    if (!quota.ok) throw new Error(`rate_limited:${quota.retryAfter}`);
    return { runId: await this.startRun(text.trim().slice(0, MAX_MESSAGE), "followup") };
  }

  async resolve(): Promise<void> {
    this.requireOwner();
    if (this.mustIncident().status === "resolved") return;
    await this.stopMonitor();
    // A card can't act on a resolved incident: pending ones end as rejected.
    const pending = this.sql<ApprovalRow>`SELECT * FROM approvals WHERE status = 'pending'`;
    const now = Date.now();
    for (const a of pending) {
      this.sql`UPDATE approvals SET status = 'rejected', decided_at = ${now},
        outcome_json = ${JSON.stringify({ ok: false, text: "No action taken: the incident was resolved by hand." })} WHERE id = ${a.id}`;
      this.event("approval", { approvalId: a.id, status: "rejected" });
    }
    await this.transition("resolved", "resolved by hand");
    for (const a of pending) await this.tellWorkflow(a, false, "resolved by hand");
  }

  /** Approve a card (owner only, D8). Idempotent: a decided card is left alone (D13). */
  async approve(approvalId: unknown): Promise<{ status: ApprovalStatus }> {
    this.requireOwner();
    const a = this.mustApproval(approvalId);
    if (a.status !== "pending") return { status: a.status };
    this.sql`UPDATE approvals SET status = 'approved', decided_at = ${Date.now()} WHERE id = ${a.id}`;
    this.event("approval", { approvalId: a.id, status: "approved" });
    this.touch();
    this.syncState();
    if (!(await this.tellWorkflow(a, true))) await this.recordApprovalOutcome(a.id, "failed", "the waiting run couldn't be reached");
    return { status: "approved" };
  }

  /** Reject a card (owner only). The incident goes back to investigating right away; the Workflow then ends. */
  async reject(approvalId: unknown): Promise<{ status: ApprovalStatus }> {
    this.requireOwner();
    const a = this.mustApproval(approvalId);
    if (a.status !== "pending") return { status: a.status };
    await this.recordApprovalOutcome(a.id, "rejected");
    await this.tellWorkflow(a, false, "rejected");
    return { status: "rejected" };
  }

  /**
   * Writes the postmortem of a resolved incident (FR-70, TDD §8.7), streaming under messageId `postmortem`, and
   * stores it (FR-71). Owner only. A stored one is returned for free; a new one that uses the AI counts against the
   * run quota (D14), and the budget guard switches it to the template.
   */
  async generatePostmortem(): Promise<{ markdown: string }> {
    this.requireOwner();
    if (this.mustIncident().status !== "resolved") throw new Error("not_resolved");
    const stored = this.storedPostmortem();
    if (stored) return { markdown: stored.markdown };
    const ip = (getCurrentAgent().connection?.state as ConnectionInfo | null)?.ip ?? null;
    this.postmortemInFlight ??= (async () => {
      const ai = (await budgetMode(d1Usage(this.env.DB))) === "ai";
      if (ai) {
        const quota = await takeRun(this.env, { workspaceId: this.mustIncident().workspace_id, ip });
        if (!quota.ok) throw new Error(`rate_limited:${quota.retryAfter}`);
      }
      return this.writePostmortem(ai);
    })().finally(() => {
      this.postmortemInFlight = null;
    });
    return { markdown: await this.postmortemInFlight };
  }

  /** The stored postmortem, for owners and viewers alike (it's part of what the incident shows). */
  getPostmortem(): { markdown: string; generatedAt: number } | null {
    return this.storedPostmortem();
  }

  async markRead(): Promise<void> {
    this.requireOwner();
    this.sql`UPDATE incident SET unread = 0 WHERE id = ${this.name}`;
    await this.upsertIndex();
  }

  /** The caller's role, for the read-only banner: the SDK doesn't tell a client that its connection is readonly. */
  whoami(): { role: ConnectionRole } {
    const { connection } = getCurrentAgent();
    return { role: (connection?.state as ConnectionInfo | null)?.role ?? "viewer" };
  }

  /** Full evidence for a check card. Open to viewers too: it's what the incident already shows. */
  getEvidence(id: unknown): { evidenceId: string; tool: ToolName; status: string; summary: string; raw: Json } | null {
    if (typeof id !== "string") return null;
    const row = this.sql<CheckRow>`SELECT * FROM checks WHERE evidence_id = ${id}`[0];
    if (!row) return null;
    return { evidenceId: row.evidence_id, tool: row.tool, status: row.status, summary: row.summary, raw: row.raw_json ? (JSON.parse(row.raw_json) as Json) : null };
  }

  // ---- internals ----

  async transition(to: IncidentStatus, reason: string): Promise<void> {
    const from = this.mustIncident().status;
    assertTransition(from, to);
    this.sql`UPDATE incident SET status = ${to} WHERE id = ${this.name}`;
    this.event("status", { from, to, reason });
    this.touch();
    this.syncState();
    await this.upsertIndex();
    if (to === "resolved") await this.releaseWatch();
    // Webhooks for any watched incident on mitigated/resolved (D18, widened by user decision in WP-19).
    if ((to === "mitigated" || to === "resolved") && this.mustIncident().watch_id) await startNotify(this.env, this.name, to);
  }

  /** Frees the incident's watch so its next failure can open a new incident. Logged, never thrown. */
  private async releaseWatch() {
    const { watch_id: watchId } = this.mustIncident();
    if (!watchId) return;
    try {
      await releaseIncident(this.env.DB, watchId, this.name);
    } catch (e) {
      console.error("could not release the watch", watchId, (e as Error).message);
    }
  }

  /** For the add_to_watchlist card: not watched yet, and the workspace can add this URL. False on a D1 error. */
  private async watchable(incident: IncidentRow): Promise<boolean> {
    if (incident.watch_id) return false;
    try {
      return await canWatch(this.env.DB, incident.workspace_id, incident.target);
    } catch (e) {
      console.error("watchlist check failed", (e as Error).message);
      return false;
    }
  }

  private storedPostmortem(): { markdown: string; generatedAt: number } | null {
    const row = this.sql<{ markdown: string; generated_at: number }>`SELECT markdown, generated_at FROM postmortem WHERE id = 1`[0];
    return row ? { markdown: row.markdown, generatedAt: row.generated_at } : null;
  }

  /**
   * Writes and stores the postmortem once (user decision "facts by code, story by AI"): the facts come from the
   * records, the AI writes the four story sections, and any section it misses comes from the template. A cut-off or
   * failed stream keeps what it got; nothing at all → the template.
   */
  private async writePostmortem(useAi: boolean): Promise<string> {
    const stored = this.storedPostmortem();
    if (stored) return stored.markdown;
    const input = this.postmortemInput();
    const facts = postmortemFacts(input);
    const fallback = templateProse(input, facts);
    let prose: Prose = fallback;
    let source: "llm" | "partial" | "template" = "template";
    const knownIds = this.sql<{ evidence_id: string }>`SELECT evidence_id FROM checks`.map((r) => r.evidence_id);
    if (useAi) {
      const messageId = "postmortem";
      const evidence = this.resultsFor(input.findings?.evidence ?? [], "").map(toLine);
      this.frame({ type: "stream_start", messageId });
      let text: string | undefined;
      try {
        const r = await streamLlm(
          llmDeps(this.env),
          { system: postmortemSystem(), messages: postmortemUser({ target: input.target, facts: factsText(facts), findings: input.findings, evidence, resolution: fallback.resolution }), maxTokens: POSTMORTEM_MAX_TOKENS },
          (delta) => this.frame({ type: "delta", messageId, text: delta }),
        );
        text = r.text;
        source = r.truncated ? "partial" : "llm";
      } catch (e) {
        console.warn("postmortem failed", (e as Error).message);
        text = e instanceof LlmUnavailable ? e.partial : undefined;
        source = "partial";
      }
      this.frame({ type: "stream_end", messageId });
      const parsed = parseProse(text ?? "", knownIds, fallback);
      prose = parsed.prose;
      if (parsed.fromAi === 0) source = "template";
    }
    prose = citeRootCause(prose, input.findings?.evidence ?? [], knownIds);
    this.sql`INSERT OR IGNORE INTO postmortem (id, markdown, generated_at) VALUES (1, ${renderPostmortem(facts, prose)}, ${Date.now()})`;
    this.event("postmortem", { source });
    this.touch();
    this.syncState();
    return this.storedPostmortem()!.markdown;
  }

  /** Everything the postmortem needs, from SQL: the full timeline (state keeps only the last 100 rows). */
  private postmortemInput(): PostmortemInput {
    const incident = this.mustIncident();
    const first = this.sql<{ question: string }>`SELECT question FROM runs ORDER BY seq LIMIT 1`[0];
    const latest = this.sql<{ findings_json: string }>`SELECT findings_json FROM runs WHERE findings_json IS NOT NULL ORDER BY seq DESC LIMIT 1`[0];
    const timeline = this.sql<{ ts: number; event_type: string; detail_json: string }>`SELECT ts, event_type, detail_json FROM timeline ORDER BY id`;
    const approvals = this.sql<ApprovalRow>`SELECT * FROM approvals ORDER BY created_at`;
    return {
      target: incident.target,
      origin: incident.origin,
      question: first?.question ?? `Scheduled check failed for ${incident.target}`,
      timeline: timeline.map((t) => ({ ts: t.ts, type: t.event_type, detail: JSON.parse(t.detail_json) as Record<string, Scalar> })),
      findings: latest ? (JSON.parse(latest.findings_json) as Findings) : null,
      approvals: approvals.map((a) => ({
        id: a.id,
        title: ACTION_TITLES[a.action_id] ?? a.action_id,
        status: a.status,
        outcome: a.outcome_json ? ((JSON.parse(a.outcome_json) as ActionOutcome).text ?? null) : null,
      })),
    };
  }

  private mustApproval(id: unknown): ApprovalRow {
    const a = typeof id === "string" ? this.sql<ApprovalRow>`SELECT * FROM approvals WHERE id = ${id}`[0] : undefined;
    if (!a) throw new Error("unknown_approval");
    return a;
  }

  private setOutcome(id: string, outcome: ActionOutcome) {
    this.sql`UPDATE approvals SET outcome_json = ${JSON.stringify(outcome)} WHERE id = ${id}`;
  }

  /** Back to investigating once no card is pending any more (a newer card keeps it awaiting approval). */
  private async leaveAwaitingApproval(reason: string) {
    const stillPending = this.sql`SELECT 1 FROM approvals WHERE status = 'pending'`.length > 0;
    if (this.mustIncident().status === "awaiting_approval" && !stillPending) await this.transition("investigating", reason);
    else {
      this.touch();
      this.syncState();
    }
  }

  /** Resumes or ends the card's waiting Workflow. Returns false if it couldn't be reached (logged, never thrown). */
  private async tellWorkflow(a: ApprovalRow, approved: boolean, reason?: string): Promise<boolean> {
    if (!a.workflow_id) return false;
    try {
      if (approved) await this.approveWorkflow(a.workflow_id, { metadata: { approvalId: a.id } });
      else await this.rejectWorkflow(a.workflow_id, { reason: reason ?? "rejected" });
      return true;
    } catch (e) {
      console.warn("could not reach the approval's workflow", a.workflow_id, (e as Error).message);
      return false;
    }
  }

  private quickCheck(): Promise<QuickCheckResult> {
    const allowOrigin = devAllowOrigin(this.env);
    return quickCheck(this.mustIncident().target, { fetch: (input, init) => fetch(input, init), ...(allowOrigin ? { allowOrigin } : {}) });
  }

  private async startMonitor(passes: number) {
    await this.stopMonitor();
    const s = await this.schedule(MONITOR_TICK_S, "monitorTick");
    this.sql`INSERT INTO monitor (id, kind, ticks_left, consecutive_passes, schedule_id) VALUES (1, 'post_action', ${MONITOR_MAX_TICKS}, ${passes}, ${s.id})`;
    this.event("monitor_started", { ticks: MONITOR_MAX_TICKS, everySec: MONITOR_TICK_S });
    this.syncState();
  }

  private async stopMonitor() {
    const m = this.sql<MonitorRow>`SELECT * FROM monitor WHERE id = 1`[0];
    if (!m) return;
    if (m.schedule_id) await this.cancelSchedule(m.schedule_id);
    this.sql`DELETE FROM monitor WHERE id = 1`;
  }

  private incident(): IncidentRow | undefined {
    try {
      return this.sql<IncidentRow>`SELECT * FROM incident LIMIT 1`[0];
    } catch {
      return undefined; // tables not created yet (before onStart)
    }
  }

  private mustIncident(): IncidentRow {
    const incident = this.incident();
    if (!incident) throw new Error("not_initialized");
    return incident;
  }

  private mustRun(runId: string): RunRow {
    const run = this.sql<RunRow>`SELECT id, seq, kind, question, status, mode, findings_json FROM runs WHERE id = ${runId}`[0];
    if (!run) throw new Error(`unknown run ${runId}`);
    return run;
  }

  private activeRunId(): string | null {
    return this.sql<{ id: string }>`SELECT id FROM runs WHERE status = 'running' ORDER BY seq DESC LIMIT 1`[0]?.id ?? null;
  }

  /** Checks cited by the findings plus this run's finished checks, as ToolResults for the template/prompt. */
  private resultsFor(ids: string[], runId: string): ToolResult[] {
    const rows = this.sql<CheckRow>`SELECT * FROM checks WHERE finished_at IS NOT NULL ORDER BY rowid`;
    const wanted = new Set(ids);
    return rows.filter((r) => wanted.has(r.evidence_id) || r.run_id === runId).map(toResult);
  }

  private addMessage(runId: string | null, role: "user" | "assistant" | "system", content: string) {
    this.sql`INSERT INTO messages (id, run_id, role, content, created_at) VALUES (${crypto.randomUUID()}, ${runId}, ${role}, ${content}, ${Date.now()})`;
  }

  private event(type: string, detail: Record<string, Scalar>) {
    this.sql`INSERT INTO timeline (ts, event_type, detail_json) VALUES (${Date.now()}, ${type}, ${JSON.stringify(detail)})`;
  }

  private touch() {
    this.sql`UPDATE incident SET updated_at = ${Date.now()} WHERE id = ${this.name}`;
  }

  private frame(f: StreamFrame) {
    this.broadcast(JSON.stringify(f));
  }

  /** Rebuilds the synced state from SQL after every change, so it can't drift. */
  private syncState() {
    const i = this.incident();
    if (!i) return;
    const latest = this.sql<{ findings_json: string }>`SELECT findings_json FROM runs WHERE findings_json IS NOT NULL ORDER BY seq DESC LIMIT 1`[0];
    const checks = this.sql<CheckRow>`SELECT * FROM checks ORDER BY rowid DESC LIMIT ${STATE_CAPS.checks}`.reverse();
    const messages = this.sql<{ id: string; run_id: string | null; role: "user" | "assistant" | "system"; content: string; created_at: number }>`
      SELECT id, run_id, role, content, created_at FROM messages ORDER BY created_at DESC, rowid DESC LIMIT ${STATE_CAPS.messages}`.reverse();
    const approvals = this.sql<ApprovalRow & { findings_json: string | null }>`
      SELECT a.*, r.findings_json FROM approvals a LEFT JOIN runs r ON r.id = a.run_id ORDER BY a.created_at DESC LIMIT ${STATE_CAPS.approvals}`;
    const timeline = this.sql<{ id: number; ts: number; event_type: string; detail_json: string }>`
      SELECT * FROM timeline ORDER BY id DESC LIMIT ${STATE_CAPS.timeline}`.reverse();
    const monitor = this.sql<{ kind: "post_action" | "burst"; ticks_left: number; consecutive_passes: number }>`SELECT * FROM monitor WHERE id = 1`[0];

    this.setState({
      id: i.id,
      target: i.target,
      origin: i.origin,
      status: i.status,
      category: (i.category as IncidentState["category"]) ?? null,
      confidence: (i.confidence as IncidentState["confidence"]) ?? null,
      mode: i.mode,
      activeRunId: this.activeRunId(),
      findings: latest ? (JSON.parse(latest.findings_json) as Findings) : null,
      checks: checks.map((c) => ({
        evidenceId: c.evidence_id,
        runId: c.run_id,
        tool: c.tool,
        label: toolLabel(c.tool),
        status: c.status as IncidentState["checks"][number]["status"],
        summary: c.summary,
        startedAt: c.started_at,
        ...(c.finished_at ? { finishedAt: c.finished_at } : {}),
      })),
      messages: messages.map((m) => ({ id: m.id, runId: m.run_id, role: m.role, content: m.content, createdAt: m.created_at })),
      approvals: approvals.map((a) => {
        const why = a.findings_json ? (JSON.parse(a.findings_json) as Findings) : null;
        const outcome = a.outcome_json ? (JSON.parse(a.outcome_json) as ActionOutcome & { verified?: boolean; done?: boolean }) : null;
        return {
          id: a.id,
          runId: a.run_id,
          actionId: a.action_id,
          title: ACTION_TITLES[a.action_id] ?? a.action_id,
          status: a.status,
          cause: why?.cause ?? "",
          evidence: why?.evidence ?? [],
          ...(outcome ? { outcome: { ok: outcome.ok, text: outcome.text, ...(outcome.verified !== undefined ? { verified: outcome.verified } : {}), ...(outcome.done ? { done: true } : {}) } } : {}),
          createdAt: a.created_at,
          ...(a.decided_at ? { decidedAt: a.decided_at } : {}),
        };
      }),
      timeline: timeline.map((t) => ({ id: t.id, ts: t.ts, type: t.event_type, detail: JSON.parse(t.detail_json) as Record<string, Scalar> })),
      monitor: monitor ? { kind: monitor.kind, passes: monitor.consecutive_passes, ticksLeft: monitor.ticks_left } : null,
      hasPostmortem: this.sql`SELECT 1 FROM postmortem WHERE id = 1`.length > 0,
    });
  }

  /** Mirrors the incident into D1 for the sidebar (D16). Errors are logged: `onStart` reconciles. */
  private async upsertIndex() {
    const i = this.incident();
    if (!i) return;
    try {
      await this.env.DB.prepare(
        `INSERT INTO incidents_index (id, workspace_id, target, status, origin, unread, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, unread = excluded.unread, updated_at = excluded.updated_at`,
      )
        .bind(i.id, i.workspace_id, i.target, i.status, i.origin, i.unread, i.created_at, i.updated_at)
        .run();
    } catch (e) {
      console.error("incidents_index upsert failed", (e as Error).message);
    }
  }
}

/**
 * WebSocket callables. `@callable()` only records the method in the SDK's registry (its decorator context
 * is unused), so registering by hand avoids a Babel decorator transform in Vite and Vitest.
 */
for (const name of ["sendMessage", "resolve", "markRead", "getEvidence", "whoami", "approve", "reject", "generatePostmortem", "getPostmortem"] as const) {
  callable()(IncidentAgent.prototype[name] as (...args: unknown[]) => unknown, undefined as unknown as ClassMethodDecoratorContext);
}

function verifyText(v: QuickCheckResult): string {
  return v.pass ? `Verified: HTTP ${v.status} in ${v.totalMs} ms.` : `Still failing after the action (${v.reason ?? "check failed"}).`;
}

function toResult(r: CheckRow): ToolResult {
  const status = r.status as ToolResult["status"];
  return {
    evidenceId: r.evidence_id,
    tool: r.tool,
    ok: status === "pass" || status === "fail",
    status,
    summary: r.summary,
    digest: r.digest ?? "{}",
    raw: r.raw_json ? JSON.parse(r.raw_json) : null,
  };
}

function toLine(r: CheckRow | ToolResult): EvidenceLine {
  return "evidence_id" in r
    ? { evidenceId: r.evidence_id, tool: r.tool, status: r.status as EvidenceLine["status"], summary: r.summary, digest: r.digest ?? "{}" }
    : { evidenceId: r.evidenceId, tool: r.tool, status: r.status, summary: r.summary, digest: r.digest };
}
