import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { BURST_STARTED_TEXT } from "../../worker/agent/IncidentAgent";
import { BURST_MAX_TICKS, BURST_TICK_S } from "../../worker/agent/monitor";
import { incidentAgent } from "../../worker/agent/stub";
import type { Findings } from "../../worker/diagnosis/categories";
import { newId } from "../../worker/lib/ids";

// ok.example.com answers 200 on the fake internet (vitest.config.ts), so every quick check passes.
const TARGET = "https://ok.example.com/";
const flaky: Findings = {
  category: "inconclusive",
  confidence: "low",
  evidence: ["http-1"],
  cause: "1 of 3 samples failed [http-1].",
  next_steps: ["Re-check."],
  actions: [],
};

async function flakyIncident() {
  const agent = await incidentAgent(env, newId());
  const { runId } = await agent.init({ workspaceId: newId(), target: TARGET, origin: "chat", message: "ok.example.com is flaky" });
  const [id] = await agent.addPendingChecks(runId!, 1, [{ tool: "http_probe", args: { url: TARGET } }]);
  await agent.recordCheck(id!, { evidenceId: id!, tool: "http_probe", ok: true, status: "fail", summary: "HTTP 500/200/200", digest: "{}", raw: { url: TARGET, samples: [] } });
  await agent.setFindings(runId!, flaky, "ai");
  return { agent, runId: runId! };
}

describe("recheck_burst (WP-24)", () => {
  it("an inconclusive real site gets the burst card; approving checks once a minute and 3 passes resolve it", async () => {
    const { agent, runId } = await flakyIncident();
    const { approvalId, actionId } = await agent.proposeAction(runId, "diag-test-1");
    expect(actionId).toBe("recheck_burst");
    expect((await agent.getSnapshot()).status).toBe("awaiting_approval");

    await agent.approve(approvalId!);
    expect(await agent.executeAction(approvalId!)).toEqual({ ok: true, text: BURST_STARTED_TEXT });
    expect(await agent.afterAction(runId, approvalId!)).toEqual({ pass: true, text: BURST_STARTED_TEXT });
    let s = await agent.getSnapshot();
    expect(s).toMatchObject({ status: "investigating", monitor: { kind: "burst", passes: 0, ticksLeft: BURST_MAX_TICKS } });
    expect(s.approvals[0]).toMatchObject({ actionId: "recheck_burst", status: "approved", outcome: { ok: true, done: true } });
    expect(s.timeline.find((t) => t.type === "monitor_started")?.detail).toMatchObject({ kind: "burst", everySec: BURST_TICK_S, ticks: BURST_MAX_TICKS });

    // The next tick is a minute out.
    // The RPC stub can't type the SDK's generic `getSchedules`.
    const [next] = (await agent.getSchedules()) as unknown as { callback: string; time: number }[];
    expect(next!.callback).toBe("monitorTick");
    expect(next!.time * 1000 - Date.now()).toBeGreaterThan((BURST_TICK_S - 5) * 1000);
    expect(next!.time * 1000 - Date.now()).toBeLessThanOrEqual(BURST_TICK_S * 1000);

    await agent.monitorTick();
    s = await agent.getSnapshot();
    expect(s).toMatchObject({ status: "mitigated", monitor: { kind: "burst", passes: 1, ticksLeft: BURST_MAX_TICKS - 1 } });
    await agent.monitorTick();
    await agent.monitorTick();
    s = await agent.getSnapshot();
    expect(s).toMatchObject({ status: "resolved", monitor: null });
    expect(s.timeline.filter((t) => t.type === "monitor_tick").map((t) => t.detail)).toEqual([
      { kind: "burst", pass: true, passes: 1, ticksLeft: 14 },
      { kind: "burst", pass: true, passes: 2, ticksLeft: 13 },
      { kind: "burst", pass: true, passes: 3, ticksLeft: 12 },
    ]);
  });

  it("isn't offered while a monitor is already running, and a second execute doesn't restart it", async () => {
    const { agent, runId } = await flakyIncident();
    const { approvalId } = await agent.proposeAction(runId, "diag-test-1");
    await agent.approve(approvalId!);
    await agent.executeAction(approvalId!);
    await agent.afterAction(runId, approvalId!);
    const schedules = async () => ((await agent.getSchedules()) as unknown as { id: string }[]).map((x) => x.id);
    const before = await schedules();
    // A retried Workflow step runs the action again: the running burst is kept, not restarted.
    await agent.executeAction(approvalId!);
    expect(await schedules()).toEqual(before);
    expect((await agent.getSnapshot()).monitor).toMatchObject({ kind: "burst", ticksLeft: BURST_MAX_TICKS });

    await agent.finishRun(runId, "done");
    const run2 = await agent.startRun("still flaky?", "followup");
    await agent.setFindings(run2, flaky, "ai");
    // The watch is the next rule action once a burst is running.
    expect((await agent.proposeAction(run2, "diag-test-2")).actionId).toBe("add_to_watchlist");
  });
});
