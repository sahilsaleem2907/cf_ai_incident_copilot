import { Agent, callable, getCurrentAgent, type Connection, type ConnectionContext } from "agents";
import type { Findings } from "../diagnosis/categories";
import { renderTemplate } from "../diagnosis/template";
import { workspaceFromCookieHeader } from "../lib/cookie";
import { llmDeps } from "../llm/client";
import { LlmUnavailable } from "../llm/models";
import { narrationSystem, narrationUser, type EvidenceLine } from "../llm/prompts";
import { streamLlm } from "../llm/stream";
import { finalizeNarration, NARRATION_MAX_TOKENS, type NarrationOutcome } from "../loop/narrate";
import type { DnsRaw } from "../tools/dns";
import { evidenceId, toolLabel } from "../tools/registry";
import type { ToolName, ToolResult } from "../tools/types";
import { SCHEMA } from "./schema.sql";
import {
  EMPTY_STATE,
  STATE_CAPS,
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

export type InitParams = { workspaceId: string; target: string; origin: Origin; message?: string; watchId?: string };
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
};

/** Prior evidence handed to a planning turn: the most recent checks only, to keep prompts small. */
const CONTEXT_CHECKS = 10;
const MAX_MESSAGE = 2000;

/**
 * One incident (TDD §3): SQL tables, synced state, owner/viewer roles (D8), the state machine (§10),
 * streamed narration (D4) and the D1 index. Workflow launch (WP-09), approvals (WP-12), watch reports
 * (WP-18) and postmortems (WP-22) are added by their WPs.
 */
export class IncidentAgent extends Agent<Cloudflare.Env, IncidentState> {
  override initialState = EMPTY_STATE;

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
    connection.setState({ role: this.roleFor(ctx) } satisfies ConnectionInfo);
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
    const runId = await this.startRun(question, "initial", p.message ? "user" : "system");
    return { runId };
  }

  /** One planning run at a time (D13). The check and insert run without an await in between. */
  async startRun(question: string, kind: RunKind, role: "user" | "system" = "user"): Promise<string> {
    if (!this.incident()) throw new Error("not_initialized");
    if (this.activeRunId()) throw new Error("run_active");
    const seq = (this.sql<{ seq: number | null }>`SELECT MAX(seq) AS seq FROM runs`[0]?.seq ?? 0) + 1;
    const runId = `run-${seq}`;
    const now = Date.now();
    this.sql`INSERT INTO runs (id, seq, kind, question, status, started_at) VALUES (${runId}, ${seq}, ${kind}, ${question}, 'running', ${now})`;
    this.addMessage(runId, role, question);
    this.event("run_started", { runId, kind });
    this.touch();
    this.syncState();
    await this.upsertIndex();
    // WP-09: start DiagnosisWorkflow here with id `diag-<incidentId>-<seq>` (TDD §8.1).
    return runId;
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
      // WP-17 switches this to rule_based when the neuron budget guard trips.
      mode: "ai",
      evidence: rows.map(toLine),
      scope: { host: new URL(incident.target).hostname, cnameTargets: [...new Set(cnameTargets)] },
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
        outcome = finalizeNarration({ text: r.text, truncated: r.truncated, knownIds, template });
      } catch (e) {
        console.warn("narration failed", (e as Error).message);
        outcome = finalizeNarration({ partial: e instanceof LlmUnavailable ? e.partial : undefined, knownIds, template });
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

  /** Ends a run and records why (TDD §8.2). Only the first call counts. */
  async finishRun(runId: string, status: Exclude<RunStatus, "running">, stats: { toolCalls?: number; llmTurns?: number } = {}): Promise<void> {
    const run = this.mustRun(runId);
    if (run.status !== "running") return;
    this.sql`UPDATE runs SET status = ${status}, finished_at = ${Date.now()}, tool_calls = ${stats.toolCalls ?? 0},
      llm_turns = ${stats.llmTurns ?? 0} WHERE id = ${runId}`;
    this.event("run_finished", { runId, status });
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
    // WP-17 adds the run quota (D14); WP-10 the "new incident for another host" check (§8.6).
    return { runId: await this.startRun(text.trim().slice(0, MAX_MESSAGE), "followup") };
  }

  async resolve(): Promise<void> {
    this.requireOwner();
    if (this.mustIncident().status === "resolved") return;
    await this.transition("resolved", "resolved by hand");
  }

  async markRead(): Promise<void> {
    this.requireOwner();
    this.sql`UPDATE incident SET unread = 0 WHERE id = ${this.name}`;
    await this.upsertIndex();
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
    // WP-19: NotifyWorkflow for watch incidents on mitigated/resolved (D18).
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
    const approvals = this.sql<{ id: string; run_id: string; action_id: string; status: IncidentState["approvals"][number]["status"]; created_at: number; decided_at: number | null }>`
      SELECT id, run_id, action_id, status, created_at, decided_at FROM approvals ORDER BY created_at DESC LIMIT ${STATE_CAPS.approvals}`;
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
      approvals: approvals.map((a) => ({ id: a.id, runId: a.run_id, actionId: a.action_id, status: a.status, createdAt: a.created_at, ...(a.decided_at ? { decidedAt: a.decided_at } : {}) })),
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
for (const name of ["sendMessage", "resolve", "markRead", "getEvidence"] as const) {
  callable()(IncidentAgent.prototype[name] as (...args: unknown[]) => unknown, undefined as unknown as ClassMethodDecoratorContext);
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
