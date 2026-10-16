import { describe, expect, it } from "vitest";
import { citeRootCause, duration, parseProse, postmortemFacts, renderPostmortem, templateProse, type PostmortemInput } from "../../worker/agent/postmortem";
import type { Findings } from "../../worker/diagnosis/categories";

const T0 = Date.parse("2026-10-16T16:05:12Z");
const at = (s: number) => T0 + s * 1000;
const findings: Findings = {
  category: "origin_5xx",
  confidence: "high",
  evidence: ["http-1"],
  cause: "The origin returns HTTP 500 on 3/3 samples [http-1].",
  next_steps: ["Check the origin's logs.", "Roll back the last deploy."],
  actions: ["restore_demo_service"],
};
const input = (over: Partial<PostmortemInput> = {}): PostmortemInput => ({
  target: "https://demo.example.com/w/abc/",
  origin: "chat",
  question: "what's wrong with my demo service?",
  findings,
  approvals: [{ id: "a1", title: "Restore the demo service to healthy", status: "approved", outcome: "The demo service is back in healthy mode. Verified: HTTP 200 in 40 ms." }],
  timeline: [
    { ts: at(0), type: "opened", detail: { origin: "chat", target: "https://demo.example.com/w/abc/" } },
    { ts: at(0), type: "run_started", detail: { runId: "run-1", kind: "initial" } },
    { ts: at(9), type: "findings", detail: { runId: "run-1", category: "origin_5xx", confidence: "high", mode: "ai" } },
    { ts: at(9), type: "approval", detail: { approvalId: "a1", status: "pending", actionId: "restore_demo_service" } },
    { ts: at(9), type: "status", detail: { from: "investigating", to: "awaiting_approval", reason: "action proposed" } },
    { ts: at(10), type: "narrated", detail: { runId: "run-1", source: "llm" } },
    { ts: at(20), type: "approval", detail: { approvalId: "a1", status: "approved" } },
    { ts: at(21), type: "action_executed", detail: { approvalId: "a1", actionId: "restore_demo_service", ok: true } },
    { ts: at(22), type: "verified", detail: { approvalId: "a1", pass: true, status: 200, ms: 40 } },
    { ts: at(22), type: "status", detail: { from: "awaiting_approval", to: "mitigated", reason: "verified after the action" } },
    { ts: at(37), type: "monitor_tick", detail: { pass: true, passes: 2, ticksLeft: 9 } },
    { ts: at(52), type: "monitor_tick", detail: { pass: true, passes: 3, ticksLeft: 8 } },
    { ts: at(52), type: "status", detail: { from: "mitigated", to: "resolved", reason: "3 passing checks in a row" } },
  ],
  ...over,
});

describe("postmortem facts (written by code)", () => {
  it("formats durations", () => {
    expect(duration(9_400)).toBe("9 s");
    expect(duration(52_000 + 60_000 * 3)).toBe("3 min 52 s");
    expect(duration(3_600_000 * 2 + 60_000 * 5)).toBe("2 h 05 min");
  });

  it("builds the impact window, detection and a UTC timeline from the records", () => {
    const f = postmortemFacts(input());
    expect(f.host).toBe("demo.example.com");
    expect(f.impact).toEqual(["- Start: 2026-10-16 16:05:12 UTC (incident opened)", "- End: 2026-10-16 16:06:04 UTC (resolved)", "- Duration: 52 s"]);
    expect(f.detection).toBe("Reported in chat: “what's wrong with my demo service?”. The first diagnosis came 9 s later.");
    expect(f.timeline).toEqual([
      "- 16:05:12 Incident opened from chat for https://demo.example.com/w/abc/",
      "- 16:05:21 Diagnosis: Origin 5xx (high confidence)",
      "- 16:05:21 Proposed: Restore the demo service to healthy",
      "- 16:05:21 Status investigating → awaiting approval (action proposed)",
      "- 16:05:32 Approved: Restore the demo service to healthy",
      "- 16:05:33 Action ran: Restore the demo service to healthy",
      "- 16:05:34 Verified after the action: HTTP 200 in 40 ms",
      "- 16:05:34 Status awaiting approval → mitigated (verified after the action)",
      "- 16:05:49 2 monitor checks, 2 passed",
      "- 16:06:04 Status mitigated → resolved (3 passing checks in a row)",
    ]);
    expect(f.resolvedBy).toBe("action");
  });

  it("describes a watch incident and an incident that isn't resolved", () => {
    const watch = input({ origin: "watch", timeline: input().timeline.slice(0, 4).map((t) => (t.type === "opened" ? { ...t, detail: { ...t.detail, origin: "watch" } } : t)) });
    const f = postmortemFacts(watch);
    expect(f.detection).toMatch(/^A scheduled watch check failed for https:\/\/demo\.example\.com\/w\/abc\/, and a re-check confirmed it\./);
    expect(f.timeline[0]).toBe("- 16:05:12 Incident opened by a failed watch check on https://demo.example.com/w/abc/");
    expect(f.impact[1]).toBe("- End: not resolved yet");
    expect(f.resolvedBy).toBeNull();
  });

  it("collapses watch checks separately from monitor checks", () => {
    const f = postmortemFacts(
      input({
        timeline: [
          { ts: at(0), type: "watch_check", detail: { pass: false } },
          { ts: at(60), type: "watch_check", detail: { pass: true } },
          { ts: at(70), type: "monitor_tick", detail: { pass: true } },
        ],
      }),
    );
    expect(f.timeline).toEqual(["- 16:05:12 2 watch checks, 1 passed", "- 16:06:22 1 monitor check, 1 passed"]);
  });
});

describe("postmortem prose (story by AI, template fallback)", () => {
  const facts = postmortemFacts(input());
  const fallback = templateProse(input(), facts);

  it("the template covers every section from the findings and approvals", () => {
    expect(fallback.summary).toBe("demo.example.com: Origin 5xx (high confidence). The incident was opened from a chat report and was resolved after 52 s.");
    expect(fallback.rootCause).toBe(findings.cause);
    expect(fallback.resolution).toBe("Restore the demo service to healthy (approved). The demo service is back in healthy mode. Verified: HTTP 200 in 40 ms.");
    expect(fallback.followUps).toBe("- Check the origin's logs.\n- Roll back the last deploy.");
    expect(templateProse(input({ approvals: [] }), { ...facts, resolvedBy: "hand" }).resolution).toBe("The incident was resolved by hand.");
    expect(templateProse(input({ approvals: [] }), { ...facts, resolvedBy: "checks" }).resolution).toBe("The endpoint recovered: 3 checks in a row passed.");
    expect(templateProse(input({ approvals: [] }), { ...facts, resolvedBy: "healthy" }).resolution).toBe("Nothing needed fixing: the first check found the endpoint healthy.");
  });

  it("takes the AI's sections, normalising 【id】 and dropping unknown IDs", () => {
    const text = "## Summary\nThe demo broke.\n\n## Root cause\nHTTP 500 【http-1】 and [dns-9].\n## Resolution\nRestored.\n## Follow-ups\n- Add alerts.";
    const { prose, fromAi } = parseProse(text, ["http-1"], fallback);
    expect(fromAi).toBe(4);
    expect(prose).toEqual({ summary: "The demo broke.", rootCause: "HTTP 500 [http-1] and .", resolution: "Restored.", followUps: "- Add alerts." });
  });

  it("fills a missing or empty section from the template, and accepts heading variants", () => {
    const { prose, fromAi } = parseProse("### **Summary:**\nShort.\n## Root Cause\n\n## Follow-up actions\n- One.", [], fallback);
    expect(fromAi).toBe(2);
    expect(prose.summary).toBe("Short.");
    expect(prose.rootCause).toBe(fallback.rootCause);
    expect(prose.resolution).toBe(fallback.resolution);
    expect(prose.followUps).toBe("- One.");
  });

  it("a site healthy at its first check is 'healthy', not 'recovered'", () => {
    const healthy = input({ approvals: [], timeline: [input().timeline[0]!, { ts: at(1), type: "status", detail: { from: "investigating", to: "resolved", reason: "healthy on first check" } }] });
    expect(postmortemFacts(healthy).resolvedBy).toBe("healthy");
  });

  it("the root cause always cites its evidence", () => {
    expect(citeRootCause({ ...fallback, rootCause: "The origin failed." }, ["http-1", "dns-9"], ["http-1"]).rootCause).toBe("The origin failed [http-1].");
    expect(citeRootCause(fallback, ["http-1"], ["http-1"])).toBe(fallback);
    expect(citeRootCause({ ...fallback, rootCause: "Unknown." }, [], ["http-1"]).rootCause).toBe("Unknown.");
  });

  it("junk is all template", () => {
    expect(parseProse("!!!!!!", [], fallback)).toEqual({ prose: fallback, fromAi: 0 });
  });

  it("renders the sections in a fixed order", () => {
    const md = renderPostmortem(facts, fallback);
    const headings = md.split("\n").filter((l) => l.startsWith("#"));
    expect(headings).toEqual(["# Postmortem: demo.example.com", "## Summary", "## Impact window", "## Detection", "## Timeline (UTC)", "## Root cause", "## Resolution", "## Follow-ups"]);
    expect(md).toContain("[http-1]");
  });
});
