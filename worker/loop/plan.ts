import type { Decision, Proposal, RunContext, VerifyResult } from "../agent/IncidentAgent";
import type { ActionOutcome } from "../actions/catalog";
import type { RunMode, RunStatus } from "../agent/state";
import type { Findings } from "../diagnosis/categories";
import { LlmUnavailable, type LlmRequest, type LlmResult, type ToolCall } from "../llm/models";
import { planningSystem, planningUser, type EvidenceLine } from "../llm/prompts";
import { assertInScope, OutOfScopeError, type Scope } from "../safety/origin";
import type { DnsRaw } from "../tools/dns";
import { llmTools, TOOLS } from "../tools/registry";
import type { ToolName, ToolResult } from "../tools/types";
import { MAX_PLAN_TURNS, MAX_TOOL_CALLS, RUN_DEADLINE_MS, SUBREQUEST_BUDGET, SubrequestBudget } from "./budget";
import { parseFindings, SUBMIT_FINDINGS } from "./findings";

/**
 * Bounds for one run (TDD §5.2). `tailReserve` keeps room for rules, findings, narrate, finish and the approval
 * tail (propose, outcome, action, verify). Each is one agent call: verify's own fetches run inside the agent.
 */
export type DiagnoseLimits = { maxTurns: number; maxTools: number; deadlineMs: number; budget: number; tailReserve: number };
export const DEFAULT_LIMITS: DiagnoseLimits = {
  maxTurns: MAX_PLAN_TURNS,
  maxTools: MAX_TOOL_CALLS,
  deadlineMs: RUN_DEADLINE_MS,
  budget: SUBREQUEST_BUDGET,
  tailReserve: 8,
};
/** gpt-oss spends part of `max_tokens` on reasoning; a cut-off submit_findings would be wasted. */
export const PLAN_MAX_TOKENS = 1500;
/** An LLM turn costs up to 2 subrequests (primary + fallback) plus 1 for `addPendingChecks`. */
const TURN_COST = 3;
/** The cheapest check: `dns_lookup` for A + AAAA on two resolvers. Below this, another tool can't fit. */
const CHEAPEST_TOOL = 4;
/** Planning-turn index used for the rule path's own checks, so its evidence IDs are retry-safe too. */
const RULES_TURN = 99;

/** The agent methods a run calls (TDD §7.2). */
export type RunAgent = {
  getRunContext(runId: string): Promise<RunContext>;
  addPendingChecks(runId: string, turn: number, calls: { tool: ToolName; args: unknown }[]): Promise<string[]>;
  recordCheck(evidenceId: string, result: ToolResult): Promise<void>;
  ruleFindings(runId: string, modelArgs: unknown): Promise<Findings>;
  setFindings(runId: string, findings: Findings, mode: RunMode): Promise<void>;
  narrate(runId: string): Promise<unknown>;
  finishRun(runId: string, status: Exclude<RunStatus, "running">, stats: { toolCalls: number; llmTurns: number }): Promise<void>;
  proposeAction(runId: string, workflowId: string): Promise<Proposal>;
  recordApprovalOutcome(approvalId: string, decision: Decision, detail?: string): Promise<void>;
  executeAction(approvalId: string): Promise<ActionOutcome>;
  afterAction(runId: string, approvalId: string): Promise<VerifyResult>;
};

export type ApprovalDecision = "approved" | "rejected" | "expired";

/**
 * What the Workflow provides. `step` is `step.do` (durable, retried; results replay after a restart);
 * `now` is only called inside steps, so every time-based decision replays the same way.
 */
export type RunIO = {
  step<T>(name: string, fn: () => Promise<T>, opts?: { retries?: number }): Promise<T>;
  now(): number;
  agent: RunAgent;
  llm(req: LlmRequest): Promise<LlmResult>;
  tool(name: ToolName, args: unknown, evidenceId: string, scope: Scope): Promise<{ result: ToolResult; subrequests: number }>;
  /** This Workflow instance's ID, stored on the approval so the agent can resume it. */
  workflowId: string;
  /** Waits (durably, up to 24 h) for the card's decision. A rejection or a timeout is returned, not thrown. */
  waitForApproval(): Promise<ApprovalDecision>;
};

export type ValidCall = { tool: ToolName; args: unknown; cap: number };
export type Validated = { tools: ValidCall[]; findings: Findings | null; findingsArgs: unknown; invalid: string[] };

/**
 * Validates one turn's calls (FR-12): zod via `prepare`, the origin pin (D6), JSON that didn't parse,
 * and `submit_findings` (whose evidence must cite checks that exist).
 */
export function validateCalls(calls: ToolCall[], scope: Scope, knownIds: readonly string[]): Validated {
  const out: Validated = { tools: [], findings: null, findingsArgs: null, invalid: [] };
  const known = new Set(knownIds);
  for (const call of calls) {
    if (call.argsError) {
      out.invalid.push(`${call.name}: ${call.argsError}`);
      continue;
    }
    if (call.name === SUBMIT_FINDINGS) {
      out.findingsArgs = call.args;
      const parsed = parseFindings(call.args);
      if (!parsed.ok) {
        out.invalid.push(`submit_findings: ${parsed.error}`);
        continue;
      }
      const evidence = parsed.findings.evidence.filter((id) => known.has(id));
      if (evidence.length === 0) {
        out.invalid.push(`submit_findings: evidence must cite checks from this incident (${[...known].join(", ") || "none yet"}).`);
        continue;
      }
      out.findings = { ...parsed.findings, evidence };
      continue;
    }
    const tool = TOOLS[call.name as ToolName];
    if (!tool) {
      out.invalid.push(`Unknown tool ${call.name}.`);
      continue;
    }
    const prepared = tool.prepare(call.args);
    if (!prepared.ok) {
      out.invalid.push(`Invalid arguments for ${call.name}: ${prepared.error}`);
      continue;
    }
    try {
      assertInScope(call.name, prepared.args, scope);
    } catch (e) {
      if (!(e instanceof OutOfScopeError)) throw e;
      out.invalid.push(e.message);
      continue;
    }
    out.tools.push({ tool: tool.name, args: prepared.args, cap: prepared.cap });
  }
  return out;
}

type TurnResult =
  | { kind: "unavailable"; reason: string; attempts: number; at: number }
  | ({ kind: "turn"; attempts: number; at: number } & Validated);

type CheckOut = { line: EvidenceLine; tool: ToolName; cnameTargets: string[]; subrequests: number; at: number };

export type ActionSummary = { approvalId: string; decision: ApprovalDecision | "error"; verified?: boolean };
export type RunSummary = {
  status: Exclude<RunStatus, "running">;
  mode: RunMode;
  toolCalls: number;
  llmTurns: number;
  category?: string;
  action?: ActionSummary;
};

/**
 * One bounded diagnosis run (TDD §8.2). Every limit ends in findings built from what was gathered
 * ("Limits keep progress"): the turn and tool caps end with a finish-only turn; the deadline, the LLM being
 * unavailable or a second invalid call go to the rules, which keep the model's valid fields.
 */
export async function diagnose(io: RunIO, runId: string, limits: DiagnoseLimits = DEFAULT_LIMITS): Promise<RunSummary> {
  const { summary, approvalId } = await investigate(io, runId, limits);
  if (!approvalId) return summary;
  return { ...summary, action: await approvalTail(io, runId, approvalId) };
}

/** Plan, check, find, narrate, propose, finish. The run is finished before any approval wait (D13). */
async function investigate(io: RunIO, runId: string, limits: DiagnoseLimits): Promise<{ summary: RunSummary; approvalId: string | null }> {
  const stats = { toolCalls: 0, llmTurns: 0 };
  let mode: RunMode = "ai";
  try {
    const ctx = await io.step("context", async () => ({ ...(await io.agent.getRunContext(runId)), startedAt: io.now() }));
    const budget = new SubrequestBudget(limits.budget);
    budget.settle(0, 1);
    budget.reserve(limits.tailReserve);

    const deadline = ctx.startedAt + limits.deadlineMs;
    let lastAt = ctx.startedAt;
    const evidence: EvidenceLine[] = [...ctx.evidence];
    // CNAME targets found during the run widen the origin pin for dns_lookup (D6).
    const cnameTargets = [...ctx.scope.cnameTargets];
    const scope: Scope = { host: ctx.scope.host, cnameTargets };
    const ranThisRun = new Set<ToolName>();
    mode = ctx.mode;

    let findings: Findings | null = null;
    let lastFindingsArgs: unknown = null;
    let limit: Exclude<RunStatus, "running" | "done" | "failed"> | null = null;
    let invalidTurns = 0;
    let feedback: string | undefined;

    /** Runs one check in its own step. Never throws: a broken check is stored as an `error` result. */
    const runCheck = async (id: string, call: ValidCall): Promise<void> => {
      if (!budget.reserve(call.cap)) {
        limit ??= "limit_budget";
        return;
      }
      let out: CheckOut;
      try {
        out = await io.step(`tool-${id}`, async () => {
          let result: ToolResult;
          let subrequests = 0;
          try {
            ({ result, subrequests } = await io.tool(call.tool, call.args, id, scope));
          } catch (e) {
            result = errorResult(id, call.tool, e);
          }
          await io.agent.recordCheck(id, result);
          const cnameTargets = result.tool === "dns_lookup" && result.ok ? ((result.raw as DnsRaw).cnameTargets ?? []) : [];
          return { line: toLine(result), tool: call.tool, cnameTargets, subrequests, at: io.now() };
        });
      } catch {
        // The step failed even after retries (e.g. the agent RPC): count the worst case and move on.
        out = { line: toLine(errorResult(id, call.tool, new Error("check could not be recorded"))), tool: call.tool, cnameTargets: [], subrequests: call.cap, at: lastAt };
      }
      budget.settle(call.cap, out.subrequests + 1);
      stats.toolCalls++;
      lastAt = out.at;
      evidence.push(out.line);
      ranThisRun.add(out.tool);
      for (const t of out.cnameTargets) if (!cnameTargets.includes(t)) cnameTargets.push(t);
    };

    if (mode === "ai") {
      for (let turn = 1; turn <= limits.maxTurns; turn++) {
        if (lastAt >= deadline) {
          limit ??= "limit_deadline";
          break;
        }
        if (budget.remaining() < TURN_COST) {
          limit ??= "limit_budget";
          break;
        }
        const toolsLeft = limits.maxTools - stats.toolCalls;
        const finishReason =
          turn === limits.maxTurns ? "limit_turns" : toolsLeft <= 0 ? "limit_tools" : budget.remaining() < TURN_COST + CHEAPEST_TOOL ? "limit_budget" : null;
        const knownIds = evidence.map((e) => e.evidenceId);
        const r = await io.step(`llm-turn-${turn}`, async (): Promise<TurnResult> => {
          try {
            const res = await io.llm({
              system: planningSystem({ target: ctx.target, toolsLeft: finishReason ? 0 : toolsLeft, turnsLeft: limits.maxTurns - turn + 1, isDemo: ctx.isDemo }),
              messages: planningUser({ question: ctx.question, evidence, ...(feedback ? { invalid: feedback } : {}) }),
              tools: llmTools({ finishOnly: !!finishReason }),
              toolChoice: "required",
              maxTokens: PLAN_MAX_TOKENS,
            });
            const v = validateCalls(res.toolCalls, scope, knownIds);
            if (res.toolCalls.length === 0) v.invalid.push("No tool call. Always call a tool or submit_findings.");
            return { kind: "turn", ...v, attempts: res.fallback ? 2 : 1, at: io.now() };
          } catch (e) {
            if (e instanceof LlmUnavailable) return { kind: "unavailable", reason: e.message, attempts: 2, at: io.now() };
            throw e;
          }
        });
        budget.settle(0, r.attempts);
        stats.llmTurns++;
        lastAt = r.at;

        if (r.kind === "unavailable") {
          mode = "rule_based";
          break;
        }
        if (r.findingsArgs !== null) lastFindingsArgs = r.findingsArgs;
        if (r.findings) {
          findings = r.findings;
          if (finishReason) limit ??= finishReason;
          break;
        }
        if (finishReason) {
          // The finish-only turn didn't produce usable findings: the rules fill in, keeping its valid fields.
          limit ??= finishReason;
          break;
        }
        if (r.invalid.length && ++invalidTurns >= 2) break;

        const notes = [...r.invalid];
        const calls = r.tools.slice(0, toolsLeft);
        if (r.tools.length > calls.length) notes.push(`Only ${toolsLeft} tool call(s) were left, so ${r.tools.length - calls.length} call(s) were dropped.`);
        feedback = notes.length ? notes.join("\n") : undefined;
        if (calls.length === 0) continue;

        const ids = await io.step(`pending-${turn}`, () => io.agent.addPendingChecks(runId, turn, calls.map(({ tool, args }) => ({ tool, args }))));
        budget.settle(0, 1);
        for (const [i, call] of calls.entries()) {
          if (lastAt >= deadline) {
            limit ??= "limit_deadline";
            break;
          }
          await runCheck(ids[i]!, call);
        }
        if (limit === "limit_deadline") break;
      }
    }

    if (!findings) {
      // Rule path / gap fill (TDD §8.2): the baseline checks this run hasn't done, if budget and time allow.
      const baseline = (
        [
          ["dns_lookup", { hostname: scope.host }],
          ["http_probe", { url: ctx.target }],
        ] as const
      ).filter(([tool]) => !ranThisRun.has(tool));
      const calls = baseline.flatMap(([tool, args]) => {
        const prepared = TOOLS[tool]?.prepare(args);
        return prepared?.ok ? [{ tool, args: prepared.args, cap: prepared.cap }] : [];
      });
      if (calls.length && lastAt < deadline && budget.remaining() >= 1 + Math.min(...calls.map((c) => c.cap))) {
        const ids = await io.step("pending-rules", () => io.agent.addPendingChecks(runId, RULES_TURN, calls.map(({ tool, args }) => ({ tool, args }))));
        budget.settle(0, 1);
        for (const [i, call] of calls.entries()) {
          if (lastAt >= deadline) break;
          await runCheck(ids[i]!, call);
        }
      }
      const args = lastFindingsArgs;
      findings = await io.step("rules", () => io.agent.ruleFindings(runId, args));
    }

    const final = findings;
    await io.step("findings", () => io.agent.setFindings(runId, final, mode));
    await io.step("narrate", () => io.agent.narrate(runId));
    const proposal = await io.step("propose", () => io.agent.proposeAction(runId, io.workflowId));
    const status = limit ?? (mode === "rule_based" && ctx.mode === "ai" ? "llm_unavailable" : "done");
    await io.step("finish", () => io.agent.finishRun(runId, status, stats));
    return { summary: { status, mode, ...stats, category: final.category }, approvalId: proposal.approvalId };
  } catch (e) {
    console.error("diagnosis run failed", runId, (e as Error).message);
    try {
      await io.step("finish-failed", () => io.agent.finishRun(runId, "failed", stats));
    } catch {
      // Nothing more to do: the agent's activeRunId stays set until someone resolves the incident.
    }
    return { summary: { status: "failed", mode, ...stats }, approvalId: null };
  }
}

/**
 * The approval tail (TDD §8.2, FR-20 to FR-23): wait for the human, then run the action and verify it. Rejected
 * or expired cards are recorded, and nothing runs. A failure here never touches the finished run.
 */
async function approvalTail(io: RunIO, runId: string, approvalId: string): Promise<ActionSummary> {
  try {
    const decision = await io.waitForApproval();
    if (decision !== "approved") {
      await io.step(`approval-${decision}`, () => io.agent.recordApprovalOutcome(approvalId, decision));
      return { approvalId, decision };
    }
    let out: ActionOutcome;
    try {
      out = await io.step("action", () => io.agent.executeAction(approvalId));
    } catch (e) {
      out = { ok: false, text: (e as Error).message };
    }
    if (!out.ok) {
      const detail = out.text;
      await io.step("action-failed", () => io.agent.recordApprovalOutcome(approvalId, "failed", detail));
      return { approvalId, decision, verified: false };
    }
    const v = await io.step("verify", () => io.agent.afterAction(runId, approvalId));
    return { approvalId, decision, verified: v.pass };
  } catch (e) {
    console.error("approval tail failed", runId, approvalId, (e as Error).message);
    return { approvalId, decision: "error" };
  }
}

function errorResult(evidenceId: string, tool: ToolName, e: unknown): ToolResult {
  const message = e instanceof Error ? e.message : String(e);
  return { evidenceId, tool, ok: false, status: "error", summary: `Check failed: ${message.slice(0, 200)}`, digest: JSON.stringify({ error: message.slice(0, 200) }), raw: null };
}

function toLine(r: ToolResult): EvidenceLine {
  return { evidenceId: r.evidenceId, tool: r.tool, status: r.status, summary: r.summary, digest: r.digest };
}
