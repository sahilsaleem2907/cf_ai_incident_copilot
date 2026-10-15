import { describe, expect, it } from "vitest";
import { CASES, failed, renderResults, score, type EvalCase, type Snapshot } from "../../eval/cases";

const ERRORS: EvalCase = { mode: "errors", expected: "origin_5xx" };
const HEALTHY: EvalCase = { mode: "healthy", expected: "healthy" };

/** A finished AI run on the broken demo that gets everything right; tests override one part at a time. */
const snap = (o: Partial<Snapshot> = {}): Snapshot => ({
  status: "awaiting_approval",
  category: "origin_5xx",
  confidence: "high",
  mode: "ai",
  activeRunId: null,
  findings: { category: "origin_5xx", evidence: ["http-1", "dns-1"], actions: ["restore_demo_service"], cause: "The origin returns 500." },
  checks: [
    { evidenceId: "dns-1", status: "pass" },
    { evidenceId: "http-1", status: "fail" },
  ],
  approvals: [{ actionId: "restore_demo_service", status: "pending" }],
  timeline: [
    { type: "run_started", detail: { runId: "run-1", kind: "initial" } },
    { type: "run_finished", detail: { runId: "run-1", status: "done", source: "model", fallbackTurns: 0 } },
  ],
  ...o,
});

describe("eval score (TDD §16)", () => {
  it("passes a right diagnosis that cites an http check and proposes the restore", () => {
    expect(score(ERRORS, snap(), 12)).toMatchObject({
      got: "origin_5xx",
      category: true,
      citation: true,
      action: true,
      source: "model",
      fallbackTurns: 0,
      runStatus: "done",
      seconds: 12,
      pass: true,
      reasons: [],
    });
  });

  it("fails the wrong category", () => {
    const s = score(ERRORS, snap({ category: "edge_error" }), 1);
    expect(s).toMatchObject({ category: false, pass: false });
    expect(s.reasons).toEqual(["category edge_error, expected origin_5xx"]);
  });

  it("needs a cited http-* check that exists and finished", () => {
    const only = (evidence: string[], checks: Snapshot["checks"]) =>
      score(ERRORS, snap({ findings: { ...snap().findings!, evidence }, checks }), 1).citation;
    expect(only(["dns-1"], [{ evidenceId: "dns-1", status: "pass" }])).toBe(false);
    expect(only(["http-2"], [{ evidenceId: "http-1", status: "fail" }])).toBe(false);
    expect(only(["http-1"], [{ evidenceId: "http-1", status: "unavailable" }])).toBe(false);
    expect(only(["http-1"], [{ evidenceId: "http-1", status: "error" }])).toBe(true);
    expect(score(ERRORS, snap({ findings: null }), 1)).toMatchObject({ citation: false, pass: false });
  });

  it("needs a restore card for a broken demo, not just the action in the findings", () => {
    const s = score(ERRORS, snap({ approvals: [] }), 1);
    expect(s).toMatchObject({ action: false, pass: false });
    expect(s.reasons).toContain("restore_demo_service not proposed");
  });

  it("fails a healthy demo that gets a restore card or a restore action", () => {
    const healthy = snap({ status: "resolved", category: "healthy", approvals: [], findings: { category: "healthy", evidence: ["http-1"], actions: [], cause: "All good." } });
    expect(score(HEALTHY, healthy, 1)).toMatchObject({ action: true, pass: true });
    expect(score(HEALTHY, { ...healthy, approvals: [{ actionId: "restore_demo_service", status: "pending" }] }, 1)).toMatchObject({ action: false, pass: false });
    expect(score(HEALTHY, { ...healthy, findings: { ...healthy.findings!, actions: ["restore_demo_service"] } }, 1).pass).toBe(false);
  });

  it("fails a run that never used the LLM, even when the rules got it right", () => {
    const s = score(ERRORS, snap({ mode: "rule_based" }), 1);
    expect(s).toMatchObject({ category: true, citation: true, action: true, runMode: "rule_based", pass: false });
    expect(s.reasons).toEqual(["fell back to rules: the LLM was not used"]);
  });

  it("reads the latest run_finished, and copes without the WP-20 details", () => {
    const s = score(ERRORS, snap({ timeline: [{ type: "run_finished", detail: { runId: "run-1", status: "limit_turns" } }] }), 1);
    expect(s).toMatchObject({ source: null, fallbackTurns: null, runStatus: "limit_turns", pass: true });
  });
});

describe("eval results.md", () => {
  it("renders the table, the pass count against the target and the failure notes", () => {
    const rows = [
      score(ERRORS, snap(), 10),
      score({ mode: "slow", expected: "high_latency" }, snap({ category: "origin_5xx" }), 14),
      failed({ mode: "bad_cache", expected: "cache_misconfiguration" }, "POST /api/incidents → 503", 0),
      score(ERRORS, snap(), 9),
      score(ERRORS, snap(), 8),
    ];
    const md = renderResults(rows, { date: "2026-10-16T01:00:00Z", target: "http://localhost:5173" });
    expect(md).toContain("**Result:** 3/5 passed (target ≥ 4/5): **not met**");
    expect(md).toContain("@cf/openai/gpt-oss-120b (primary)");
    expect(md).toContain("| `errors` | `origin_5xx` | `origin_5xx` | high | ✓ | ✓ | ✓ | model | 0 | done | 10 s | **pass** |");
    expect(md).toContain("| `bad_cache` | `cache_misconfiguration` | – | – | ✗ | ✗ | ✗ | - | – | – | 0 s | fail |");
    expect(md).toContain("- `slow`: category origin_5xx, expected high_latency");
    expect(md).toContain("- `bad_cache`: POST /api/incidents → 503");
  });

  it("covers the four failure modes and the healthy control", () => {
    expect(CASES.map((c) => c.mode)).toEqual(["slow", "errors", "redirect_loop", "bad_cache", "healthy"]);
  });
});
