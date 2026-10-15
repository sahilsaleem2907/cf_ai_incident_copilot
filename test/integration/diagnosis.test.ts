import { introspectWorkflow } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { incidentAgent } from "../../worker/agent/stub";
import { newId } from "../../worker/lib/ids";

/**
 * Real DiagnosisWorkflow runs: local Workflows, the mock LLM (LLM_MODE=mock) and the fake internet from
 * vitest.config.ts (broken.example.com → 500, ok.example.com → 200, DoH for *.example.com).
 */
async function diagnoseRun(message: string, target: string) {
  const introspector = await introspectWorkflow(env.DIAGNOSIS_WORKFLOW);
  try {
    const id = newId();
    const agent = await incidentAgent(env, id);
    const { runId } = await agent.init({ workspaceId: newId(), target, origin: "chat", message });
    expect(await agent.launchRun(runId!)).toBe(`diag-${id}-1`);
    const [instance] = await introspector.get();
    await instance!.waitForStatus("complete");
    return { id, agent, runId: runId!, output: await instance!.getOutput(), snapshot: await agent.getSnapshot() };
  } finally {
    await introspector.dispose();
  }
}

const finished = (s: Awaited<ReturnType<typeof diagnoseRun>>["snapshot"]) => s.timeline.filter((t) => t.type === "run_finished").map((t) => t.detail.status);

describe("DiagnosisWorkflow (mock LLM, fake internet)", () => {
  it("diagnoses a failing origin end to end", async () => {
    const { snapshot: s, output, runId } = await diagnoseRun("why is broken.example.com down?", "https://broken.example.com/");
    expect(output).toMatchObject({ status: "done", mode: "ai", toolCalls: 2, llmTurns: 2, category: "origin_5xx" });
    expect(s.checks.map((c) => [c.evidenceId, c.status])).toEqual([
      ["dns-1", "pass"],
      ["http-1", "fail"],
    ]);
    expect(s).toMatchObject({ category: "origin_5xx", status: "investigating", activeRunId: null, mode: "ai" });
    const narration = s.messages.find((m) => m.id === `narr-${runId}`)!;
    expect(narration.content).toContain("[http-1]");
    expect(finished(s)).toEqual(["done"]);
  });

  it("resolves a healthy site on its first run", async () => {
    const { snapshot: s } = await diagnoseRun("is ok.example.com up?", "https://ok.example.com/");
    expect(s).toMatchObject({ category: "healthy", status: "resolved", activeRunId: null });
  });

  it("falls back to the rules when the LLM is down", async () => {
    const { snapshot: s, output } = await diagnoseRun("broken.example.com #llm-down", "https://broken.example.com/");
    expect(output).toMatchObject({ status: "llm_unavailable", mode: "rule_based", llmTurns: 1 });
    expect(s).toMatchObject({ category: "origin_5xx", mode: "rule_based", activeRunId: null });
    expect(s.checks.map((c) => c.tool)).toEqual(["dns_lookup", "http_probe"]);
    expect(s.messages.at(-1)!.content).toContain("- HTTP probe: HTTP 500/500/500");
    expect(finished(s)).toEqual(["llm_unavailable"]);
  });

  it("goes to the rules after two invalid calls", async () => {
    const { snapshot: s, output } = await diagnoseRun("broken.example.com #llm-invalid", "https://broken.example.com/");
    expect(output).toMatchObject({ status: "done", mode: "ai", llmTurns: 2 });
    expect(s).toMatchObject({ category: "origin_5xx", activeRunId: null });
  });

  it("reports a name that doesn't resolve", async () => {
    const { snapshot: s } = await diagnoseRun("nxdomain.example.com is down", "https://nxdomain.example.com/");
    expect(s.category).toBe("dns_failure");
  });

  it("runs a follow-up as a second Workflow that sees the earlier evidence", async () => {
    const first = await diagnoseRun("why is broken.example.com down?", "https://broken.example.com/");
    const introspector = await introspectWorkflow(env.DIAGNOSIS_WORKFLOW);
    try {
      const runId = await first.agent.startRun("still broken?", "followup");
      expect(runId).toBe("run-2");
      expect((await first.agent.getRunContext(runId)).evidence.map((e) => e.evidenceId)).toEqual(["dns-1", "http-1"]);
      await first.agent.launchRun(runId);
      const [instance] = await introspector.get();
      await instance!.waitForStatus("complete");
      const s = await first.agent.getSnapshot();
      expect(s.activeRunId).toBeNull();
      expect(s.messages.filter((m) => m.role === "assistant").map((m) => m.id)).toEqual(["narr-run-1", "narr-run-2"]);
    } finally {
      await introspector.dispose();
    }
  });
});
