import { describe, expect, it } from "vitest";
import type { RunContext } from "../../worker/agent/IncidentAgent";
import type { Findings } from "../../worker/diagnosis/categories";
import { LlmUnavailable, type LlmRequest, type LlmResult } from "../../worker/llm/models";
import { salvageFindings } from "../../worker/loop/findings";
import { DEFAULT_LIMITS, diagnose, validateCalls, type ApprovalDecision, type DiagnoseLimits, type RunIO } from "../../worker/loop/plan";
import type { ToolName, ToolResult } from "../../worker/tools/types";

const TARGET = "https://shop.example.com/";
const HOST = "shop.example.com";

type Reply = LlmResult | Error;
const reply = (...calls: [string, unknown][]): LlmResult => ({
  toolCalls: calls.map(([name, args], i) => ({ id: `c${i}`, name, args })),
  usage: { in: 0, out: 0, neurons: 1 },
  model: "gpt",
  fallback: false,
});
const dns = (): [string, unknown] => ["dns_lookup", { hostname: HOST }];
const http = (path = ""): [string, unknown] => ["http_probe", { url: `${TARGET}${path}` }];
const submit = (evidence: string[], extra: Partial<Findings> = {}): [string, unknown] => [
  "submit_findings",
  { category: "origin_5xx", confidence: "high", evidence, cause: "The origin fails.", next_steps: ["Check logs."], actions: [], ...extra },
];

const RULES: Findings = { category: "inconclusive", confidence: "low", evidence: [], cause: "Rules.", next_steps: ["Retry."], actions: ["restore_demo_service"] };

/** A fake Workflow: steps run inline, an in-memory agent, scripted model turns and a clock that ticks per step. */
function harness(
  o: {
    replies?: Reply[];
    tool?: (name: ToolName, id: string) => ToolResult | Error;
    ctx?: Partial<RunContext>;
    tick?: number;
    failSetFindings?: boolean;
    /** A card is proposed (approvalId "a-1") and decided like this; omitted → nothing proposed. */
    approval?: ApprovalDecision;
    actionFails?: boolean;
    verifyPass?: boolean;
  } = {},
) {
  let t = 1_000_000;
  const steps: string[] = [];
  const requests: LlmRequest[] = [];
  const counters: Record<string, number> = {};
  const recorded: ToolResult[] = [];
  const log: {
    findings?: { f: Findings; mode: string };
    narrated?: boolean;
    finish?: { status: string; stats: unknown };
    ruleArgs?: unknown;
    proposedBy?: string;
    outcome?: { decision: string; detail?: string };
  } = {};
  const replies = [...(o.replies ?? [])];

  const io: RunIO = {
    step: async (name, fn) => {
      steps.push(name);
      return fn();
    },
    now: () => (t += o.tick ?? 100),
    agent: {
      getRunContext: async (runId) => ({
        incidentId: "i",
        runId,
        target: TARGET,
        question: "why is it down?",
        kind: "initial",
        mode: "ai",
        evidence: [],
        scope: { host: HOST, cnameTargets: [] },
        isDemo: false,
        ...o.ctx,
      }),
      addPendingChecks: async (_runId, _turn, calls) =>
        calls.map((c) => {
          const prefix = c.tool === "dns_lookup" ? "dns" : "http";
          counters[prefix] = (counters[prefix] ?? 0) + 1;
          return `${prefix}-${counters[prefix]}`;
        }),
      recordCheck: async (_id, result) => void recorded.push(result),
      ruleFindings: async (_runId, args) => {
        log.ruleArgs = args;
        return salvageFindings(args, { ...RULES, evidence: recorded.slice(-1).map((r) => r.evidenceId) }, recorded.map((r) => r.evidenceId)).findings;
      },
      setFindings: async (_runId, f, mode) => {
        if (o.failSetFindings) throw new Error("D1 down");
        log.findings = { f, mode };
      },
      narrate: async () => void (log.narrated = true),
      finishRun: async (_runId, status, stats) => void (log.finish = { status, stats: { ...stats } }),
      proposeAction: async (_runId, workflowId) => {
        log.proposedBy = workflowId;
        return o.approval ? { approvalId: "a-1", actionId: "restore_demo_service" } : { approvalId: null, actionId: null };
      },
      recordApprovalOutcome: async (_id, decision, detail) => void (log.outcome = { decision, ...(detail ? { detail } : {}) }),
      executeAction: async () => {
        if (o.actionFails) throw new Error("demo unreachable");
        return { ok: true, text: "Restored." };
      },
      afterAction: async () => ({ pass: o.verifyPass ?? true, text: "Verified." }),
    },
    workflowId: "diag-i-1",
    waitForApproval: async () => {
      steps.push("wait-for-approval");
      return o.approval ?? "expired";
    },
    llm: async (req) => {
      requests.push(req);
      const next = replies.shift() ?? reply();
      if (next instanceof Error) throw next;
      return next;
    },
    tool: async (name, _args, evidenceId) => {
      const r = o.tool?.(name, evidenceId) ?? { evidenceId, tool: name, ok: true, status: "fail" as const, summary: `${name} ok`, digest: "{}", raw: name === "dns_lookup" ? { cnameTargets: [] } : {} };
      if (r instanceof Error) throw r;
      return { result: { ...r, evidenceId }, subrequests: name === "dns_lookup" ? 4 : 6 };
    },
  };
  return { io, steps, requests, recorded, log };
}

// Most tests exercise the planning turns themselves, so the baseline checks (WP-13b) are off unless asked for.
const run = (h: ReturnType<typeof harness>, limits: Partial<DiagnoseLimits> = {}) => diagnose(h.io, "run-1", { ...DEFAULT_LIMITS, baseline: false, ...limits });
const offered = (req: LlmRequest) => req.tools!.map((t) => t.function.name);

describe("diagnose: normal runs", () => {
  it("plans, runs checks, takes the model's findings, narrates and finishes", async () => {
    const h = harness({ replies: [reply(dns(), http()), reply(submit(["http-1", "dns-1"]))] });
    const out = await run(h);
    expect(out).toEqual({ status: "done", mode: "ai", toolCalls: 2, llmTurns: 2, category: "origin_5xx" });
    expect(h.steps).toEqual(["context", "llm-turn-1", "pending-1", "tool-dns-1", "tool-http-1", "llm-turn-2", "findings", "propose", "narrate", "finish"]);
    expect(h.log.findings).toEqual({ f: expect.objectContaining({ category: "origin_5xx", evidence: ["http-1", "dns-1"] }), mode: "ai" });
    expect(h.log.finish).toEqual({ status: "done", stats: { toolCalls: 2, llmTurns: 2, fallbackTurns: 0, source: "model" } });
    expect(h.requests[0]).toMatchObject({ toolChoice: "required" });
    expect(offered(h.requests[0]!)).toEqual(["dns_lookup", "http_probe", "submit_findings"]);
    expect(h.requests[1]!.messages[0]!.content).toContain("[http-1] http_probe (fail): http_probe ok");
  });

  it("uses no LLM at all when the run is rule-based", async () => {
    const h = harness({ ctx: { mode: "rule_based" } });
    const out = await run(h);
    expect(h.requests).toHaveLength(0);
    expect(h.recorded.map((r) => r.tool)).toEqual(["dns_lookup", "http_probe"]);
    expect(out).toMatchObject({ status: "done", mode: "rule_based" });
    expect(h.log.findings?.mode).toBe("rule_based");
    expect(h.log.finish?.stats).toMatchObject({ source: "rules", fallbackTurns: 0 });
  });

  it("counts the turns the fallback model answered (WP-20)", async () => {
    const h = harness({ replies: [{ ...reply(http()), fallback: true }, reply(submit(["http-1"]))] });
    await run(h);
    expect(h.log.finish?.stats).toMatchObject({ fallbackTurns: 1, source: "model" });
  });
});

describe("diagnose: invalid calls (FR-12)", () => {
  it("feeds the first invalid call back to the model", async () => {
    const h = harness({ replies: [reply(["http_probe", { url: 42 }]), reply(http()), reply(submit(["http-1"]))] });
    const out = await run(h);
    expect(h.requests[1]!.messages[0]!.content).toContain("Your previous call was invalid: Invalid arguments for http_probe");
    // The invalid call used turn 1, so turn 3 was the forced finish turn.
    expect(out).toMatchObject({ status: "limit_turns", category: "origin_5xx" });
  });

  it("treats a host outside the origin pin as invalid", async () => {
    const h = harness({ replies: [reply(["http_probe", { url: "https://evil.example.net/" }]), reply(http()), reply(submit(["http-1"]))] });
    await run(h);
    expect(h.requests[1]!.messages[0]!.content).toMatch(/invalid: .*evil\.example\.net/);
  });

  it("goes to the rules after a second invalid turn, keeping the model's valid fields", async () => {
    const bad = submit(["The site is broken"], { category: "high_latency", cause: "It is slow." });
    const h = harness({ replies: [reply(bad), reply(bad)] });
    const out = await run(h);
    expect(h.requests).toHaveLength(2);
    // The rule path fills in the baseline checks, then keeps the model's category and cause.
    expect(h.recorded.map((r) => r.tool)).toEqual(["dns_lookup", "http_probe"]);
    expect(h.log.ruleArgs).toMatchObject({ category: "high_latency" });
    expect(h.log.findings?.f).toMatchObject({ category: "high_latency", cause: "It is slow.", evidence: ["http-1"] });
    expect(out).toMatchObject({ status: "done", mode: "ai" });
    expect(h.log.finish?.stats).toMatchObject({ source: "model+rules" });
  });

  it("rejects findings that cite checks which don't exist", async () => {
    const h = harness({ replies: [reply(submit(["http-9"])), reply(http()), reply(submit(["http-1"]))] });
    await run(h);
    expect(h.requests[1]!.messages[0]!.content).toContain("evidence must cite checks from this incident");
  });
});

describe("diagnose: every limit still ends in findings (TDD §8.2)", () => {
  it("LLM unavailable → baseline checks + rules, rule-based mode", async () => {
    const h = harness({ replies: [new LlmUnavailable("failed", "both models down")] });
    const out = await run(h);
    expect(h.recorded.map((r) => r.tool)).toEqual(["dns_lookup", "http_probe"]);
    expect(h.steps).toEqual(["context", "llm-turn-1", "pending-rules", "tool-dns-1", "tool-http-1", "rules", "findings", "propose", "narrate", "finish"]);
    expect(out).toMatchObject({ status: "llm_unavailable", mode: "rule_based", llmTurns: 1 });
    expect(h.log.finish?.status).toBe("llm_unavailable");
    expect(h.log.finish?.stats).toMatchObject({ source: "rules", fallbackTurns: 0 });
  });

  it("only runs the baseline checks this run hasn't done", async () => {
    const h = harness({ replies: [reply(http()), new LlmUnavailable("failed", "down")] });
    await run(h);
    expect(h.recorded.map((r) => r.tool)).toEqual(["http_probe", "dns_lookup"]);
  });

  it("tool cap → a finish-only turn, the model's findings, limit_tools", async () => {
    // Cheap A-only lookups (cap 2 each), so the tool cap hits before the subrequest budget.
    const many = reply(...Array.from({ length: 8 }, (): [string, unknown] => ["dns_lookup", { hostname: HOST, types: ["A"] }]));
    const h = harness({ replies: [many, reply(submit(["dns-1", "dns-6"]))] });
    const out = await run(h);
    expect(out).toMatchObject({ status: "limit_tools", toolCalls: 6, category: "origin_5xx" });
    // The model is told its extra calls didn't run, so it doesn't assume their results.
    expect(h.requests[1]!.messages[0]!.content).toContain("Only 6 tool call(s) were left, so 2 call(s) were dropped.");
    expect(offered(h.requests[1]!)).toEqual(["submit_findings"]);
    expect(h.requests[1]!.system).toContain("This is your last turn");
  });

  it("turn cap → the last turn is finish-only, limit_turns", async () => {
    const h = harness({ replies: [reply(http("a")), reply(http("b")), reply(submit(["http-2"]))] });
    const out = await run(h);
    expect(offered(h.requests[2]!)).toEqual(["submit_findings"]);
    expect(out).toMatchObject({ status: "limit_turns", llmTurns: 3, category: "origin_5xx" });
  });

  it("a finish-only turn without usable findings still ends in rule findings", async () => {
    const h = harness({ replies: [reply(http("a")), reply(http("b")), reply(http("c"))] });
    const out = await run(h);
    expect(h.steps).toContain("rules");
    expect(out).toMatchObject({ status: "limit_turns", category: "inconclusive" });
  });

  it("budget → skips what doesn't fit, finishes with the model's findings, limit_budget; the tail still runs", async () => {
    // 1 context + 8 tail + 3 for turn 1 + 5 for the DNS check = 17 of 22: the http probe (20 cap) can't fit,
    // and 5 left is too little for another tool + turn, so turn 2 is finish-only.
    const h = harness({ replies: [reply(dns(), http()), reply(submit(["dns-1"]))] });
    const out = await run(h, { budget: 22 });
    expect(h.recorded.map((r) => r.tool)).toEqual(["dns_lookup"]);
    expect(offered(h.requests[1]!)).toEqual(["submit_findings"]);
    expect(out).toMatchObject({ status: "limit_budget", category: "origin_5xx" });
    expect(h.steps.slice(-4)).toEqual(["findings", "propose", "narrate", "finish"]);
  });

  it("deadline → no more LLM turns; rules keep the evidence so far, limit_deadline", async () => {
    const h = harness({ replies: [reply(dns(), http()), reply(submit(["http-1"]))], tick: 25_000 });
    const out = await run(h);
    expect(h.requests).toHaveLength(1);
    expect(h.recorded.length).toBeGreaterThanOrEqual(1);
    expect(h.steps).toContain("rules");
    expect(out).toMatchObject({ status: "limit_deadline" });
  });

  it("a check that throws is recorded as an error and the run carries on", async () => {
    const h = harness({ replies: [reply(dns(), http()), reply(submit(["dns-1"]))], tool: (name, id) => (name === "http_probe" ? new Error("socket hang up") : { evidenceId: id, tool: name, ok: true, status: "pass", summary: "ok", digest: "{}", raw: {} }) });
    const out = await run(h);
    expect(h.recorded[1]).toMatchObject({ tool: "http_probe", status: "error", summary: "Check failed: socket hang up" });
    expect(out.status).toBe("done");
  });

  it("an unexpected failure finishes the run as failed, so the composer is freed", async () => {
    const h = harness({ replies: [reply(http()), reply(submit(["http-1"]))], failSetFindings: true });
    const out = await run(h);
    expect(out.status).toBe("failed");
    expect(h.log.finish?.status).toBe("failed");
    expect(h.steps.at(-1)).toBe("finish-failed");
  });
});

describe("diagnose: approval tail (TDD §8.2)", () => {
  const broken = () => [reply(http()), reply(submit(["http-1"]))];

  it("doesn't wait when nothing is proposed", async () => {
    const h = harness({ replies: broken() });
    const out = await run(h);
    expect(h.steps).not.toContain("wait-for-approval");
    expect(out.action).toBeUndefined();
    expect(h.log.proposedBy).toBe("diag-i-1");
  });

  it("finishes the run before waiting, then acts and verifies on approval", async () => {
    const h = harness({ replies: broken(), approval: "approved" });
    const out = await run(h);
    expect(h.steps.slice(-6)).toEqual(["propose", "narrate", "finish", "wait-for-approval", "action", "verify"]);
    expect(out).toMatchObject({ status: "done", category: "origin_5xx", action: { approvalId: "a-1", decision: "approved", verified: true } });
  });

  it("reports a verify that still fails", async () => {
    const out = await run(harness({ replies: broken(), approval: "approved", verifyPass: false }));
    expect(out.action).toEqual({ approvalId: "a-1", decision: "approved", verified: false });
  });

  it.each(["rejected", "expired"] as const)("records a %s card and runs nothing", async (decision) => {
    const h = harness({ replies: broken(), approval: decision });
    const out = await run(h);
    expect(h.steps.slice(-2)).toEqual(["wait-for-approval", `approval-${decision}`]);
    expect(h.log.outcome).toEqual({ decision });
    expect(out.action).toEqual({ approvalId: "a-1", decision });
  });

  it("records a failed action and skips verify", async () => {
    const h = harness({ replies: broken(), approval: "approved", actionFails: true });
    const out = await run(h);
    expect(h.steps.slice(-3)).toEqual(["wait-for-approval", "action", "action-failed"]);
    expect(h.log.outcome).toEqual({ decision: "failed", detail: "demo unreachable" });
    expect(out.action).toEqual({ approvalId: "a-1", decision: "approved", verified: false });
  });

  it("tells the model when the target is the demo", async () => {
    const h = harness({ replies: broken(), ctx: { isDemo: true } });
    await run(h);
    expect(h.requests[0]!.system).toContain("This target is the user's own demo service");
  });
});

describe("diagnose: baseline checks first (WP-13b)", () => {
  it("runs DNS + HTTP before the first AI turn of a new incident, so the model can submit right away", async () => {
    const h = harness({ replies: [reply(submit(["http-1", "dns-1"]))] });
    const out = await run(h, { baseline: true });
    expect(h.steps.slice(0, 5)).toEqual(["context", "pending-baseline", "tool-dns-1", "tool-http-1", "llm-turn-1"]);
    expect(h.requests[0]!.messages[0]!.content).toContain("[http-1] http_probe");
    expect(out).toEqual({ status: "done", mode: "ai", toolCalls: 2, llmTurns: 1, category: "origin_5xx" });
  });

  it("counts the baseline against the tool cap", async () => {
    const h = harness({ replies: [reply(http("a"), http("b"), http("c"), http("d"), http("e")), reply(submit(["http-1"]))] });
    // A large subrequest budget, so the tool cap (6) is the limit that bites.
    const out = await run(h, { baseline: true, budget: 500 });
    expect(h.recorded).toHaveLength(6);
    expect(h.requests[0]!.system).toContain("at most 4 more tool call(s)");
    expect(out.toolCalls).toBe(6);
  });

  it("skips the baseline for follow-ups, which reuse the incident's evidence", async () => {
    const h = harness({ replies: [reply(submit(["http-1"]))], ctx: { kind: "followup", evidence: [{ evidenceId: "http-1", tool: "http_probe", status: "fail", summary: "500", digest: "{}" }] } });
    await run(h, { baseline: true });
    expect(h.steps).not.toContain("pending-baseline");
  });

  it("doesn't repeat the baseline on the rule path", async () => {
    const h = harness({ replies: [new LlmUnavailable("failed", "down")] });
    const out = await run(h, { baseline: true });
    expect(h.recorded.map((r) => r.tool)).toEqual(["dns_lookup", "http_probe"]);
    expect(h.steps).not.toContain("pending-rules");
    expect(out).toMatchObject({ status: "llm_unavailable", mode: "rule_based" });
  });
});

describe("validateCalls", () => {
  it("separates valid tools, findings and invalid calls", () => {
    const v = validateCalls(
      [
        { id: "1", name: "dns_lookup", args: { hostname: HOST } },
        { id: "2", name: "rm_rf", args: {} },
        { id: "3", name: "http_probe", args: null, argsError: "arguments are not valid JSON" },
        { id: "4", name: "dns_lookup", args: { hostname: "other.example.org" } },
      ],
      { host: HOST, cnameTargets: [] },
      [],
    );
    expect(v.tools).toEqual([{ tool: "dns_lookup", args: { hostname: HOST, types: ["A", "AAAA"] }, cap: 4 }]);
    expect(v.invalid).toHaveLength(3);
  });
});
