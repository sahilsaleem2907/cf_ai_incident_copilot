import { introspectWorkflow, type WorkflowIntrospector } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import type { IncidentState } from "../../worker/agent/state";
import { incidentAgent } from "../../worker/agent/stub";
import { newId } from "../../worker/lib/ids";
import { connect } from "./helpers/ws";

/**
 * Approve → act → verify → monitor (TDD §8.2–§8.4) with real local Workflows, the mock LLM, and the demo stub
 * serving the test demo host through the fake internet (vitest.config.ts): "errors" → 500, otherwise 200.
 */
const demoStub = env.DEMO as unknown as typeof env.DEMO & { calls(ws: string): Promise<{ ws: string; modes: string[] }[]> };

let introspector: WorkflowIntrospector | null = null;
afterEach(async () => {
  await introspector?.dispose();
  introspector = null;
});

async function until(check: (s: IncidentState) => boolean, get: () => Promise<IncidentState>, ms = 8000): Promise<IncidentState> {
  const end = Date.now() + ms;
  for (;;) {
    const s = await get();
    if (check(s)) return s;
    if (Date.now() > end) throw new Error(`timed out; status=${s.status} approvals=${JSON.stringify(s.approvals.map((a) => a.status))}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * The card is shown *and* the run is finished. The Workflow proposes the card one step before `finish`, so
 * waiting for the card alone can catch the run still active (a real flake, reproduced by polling every 1 ms).
 */
const cardShown = (s: IncidentState) => s.approvals.length > 0 && s.activeRunId === null;

/** Breaks a fresh workspace's demo, asks about it, and waits for the approval card. */
async function brokenDemo(opts: { timeout?: boolean } = {}) {
  introspector = await introspectWorkflow(env.DIAGNOSIS_WORKFLOW);
  if (opts.timeout) await introspector.modifyAll((m) => m.forceEventTimeout({ name: "wait-for-approval" }));
  const ws = newId();
  const id = newId();
  await env.DEMO.setModes(ws, ["errors"]);
  const agent = await incidentAgent(env, id);
  const { runId } = await agent.init({ workspaceId: ws, target: `${env.DEMO_BASE_URL}/w/${ws}/`, origin: "chat", message: "what's wrong with my demo service?" });
  await agent.launchRun(runId!);
  const [instance] = await introspector.get();
  const snapshot = () => agent.getSnapshot();
  return { ws, id, agent, instance: instance!, snapshot };
}

describe("approval: restore the demo (FR-20 to FR-23)", () => {
  it("proposes a card, and on approve restores, verifies, and resolves after the monitor's passes", async () => {
    const { ws, agent, instance, snapshot } = await brokenDemo();
    const card = await until(cardShown, snapshot);
    expect(card).toMatchObject({ status: "awaiting_approval", category: "origin_5xx", activeRunId: null });
    expect(card.approvals[0]).toMatchObject({ actionId: "restore_demo_service", title: "Restore the demo service to healthy", status: "pending", evidence: ["http-1", "dns-1"] });
    expect(card.approvals[0]!.cause).toBeTruthy();

    expect(await agent.approve(card.approvals[0]!.id)).toEqual({ status: "approved" });
    await instance.waitForStatus("complete");
    expect(await instance.getOutput()).toMatchObject({ category: "origin_5xx", action: { decision: "approved", verified: true } });
    expect(await demoStub.calls(ws)).toEqual([
      { ws, modes: ["errors"] },
      { ws, modes: ["healthy"] },
    ]);

    let s = await snapshot();
    expect(s).toMatchObject({ status: "mitigated", monitor: { kind: "post_action", passes: 1, ticksLeft: 10 } });
    expect(s.approvals[0]).toMatchObject({ status: "approved", outcome: { ok: true, verified: true } });
    expect(s.approvals[0]!.outcome!.text).toMatch(/healthy mode\. Verified: HTTP 200/);

    await agent.monitorTick();
    expect(await snapshot()).toMatchObject({ status: "mitigated", monitor: { passes: 2, ticksLeft: 9 } });
    await agent.monitorTick();
    s = await snapshot();
    expect(s).toMatchObject({ status: "resolved", monitor: null });
    expect(s.timeline.filter((t) => t.type === "status").map((t) => t.detail.to)).toEqual(["awaiting_approval", "mitigated", "resolved"]);
  });

  it("approve is idempotent: a second click doesn't run the action again", async () => {
    const { ws, agent, instance, snapshot } = await brokenDemo();
    const { approvals } = await until(cardShown, snapshot);
    await agent.approve(approvals[0]!.id);
    expect(await agent.approve(approvals[0]!.id)).toEqual({ status: "approved" });
    await instance.waitForStatus("complete");
    expect((await demoStub.calls(ws)).filter((c) => c.modes[0] === "healthy")).toHaveLength(1);
  });

  it("reject → back to investigating, nothing runs", async () => {
    const { ws, agent, instance, snapshot } = await brokenDemo();
    const { approvals } = await until(cardShown, snapshot);
    expect(await agent.reject(approvals[0]!.id)).toEqual({ status: "rejected" });
    expect(await snapshot()).toMatchObject({ status: "investigating" });
    await instance.waitForStatus("complete");
    expect(await instance.getOutput()).toMatchObject({ action: { decision: "rejected" } });
    const s = await snapshot();
    expect(s.approvals[0]).toMatchObject({ status: "rejected", outcome: { ok: false, text: "Rejected: no action taken." } });
    expect(await demoStub.calls(ws)).toEqual([{ ws, modes: ["errors"] }]);
    // A decided card stays decided.
    expect(await agent.approve(approvals[0]!.id)).toEqual({ status: "rejected" });
  });

  it("an approval that times out expires: no action taken", async () => {
    const { ws, instance, snapshot } = await brokenDemo({ timeout: true });
    await instance.waitForStatus("complete");
    expect(await instance.getOutput()).toMatchObject({ action: { decision: "expired" } });
    const s = await snapshot();
    expect(s).toMatchObject({ status: "investigating" });
    expect(s.approvals[0]).toMatchObject({ status: "expired", outcome: { text: "No action taken: the approval expired after 24 hours." } });
    expect(await demoStub.calls(ws)).toEqual([{ ws, modes: ["errors"] }]);
  });

  it("a viewer can't approve or reject", async () => {
    const { id, ws, snapshot } = await brokenDemo();
    const { approvals } = await until(cardShown, snapshot);
    const sock = await connect(id, newId());
    await sock.state();
    for (const method of ["approve", "reject"]) {
      const r = await sock.rpc(method, [approvals[0]!.id]);
      expect(r).toMatchObject({ success: false });
      expect(r.error).toContain("view-only");
    }
    sock.close();
    expect((await snapshot()).approvals[0]!.status).toBe("pending");
    expect(await demoStub.calls(ws)).toEqual([{ ws, modes: ["errors"] }]);
  });

  it("resolving by hand closes the pending card and stops the monitor", async () => {
    const { agent, instance, snapshot } = await brokenDemo();
    await until(cardShown, snapshot);
    await agent.resolve();
    await instance.waitForStatus("complete");
    const s = await snapshot();
    expect(s).toMatchObject({ status: "resolved", monitor: null });
    expect(s.approvals[0]).toMatchObject({ status: "rejected", outcome: { text: "No action taken: the incident was resolved by hand." } });
  });
});

describe("approval: one card at a time (D13)", () => {
  it("a follow-up with the same proposal is deduplicated, and its run doesn't wait", async () => {
    const first = await brokenDemo();
    const { approvals } = await until(cardShown, first.snapshot);
    const runId = await first.agent.startRun("still broken?", "followup");
    await first.agent.launchRun(runId);
    const instances = await introspector!.get();
    await instances.at(-1)!.waitForStatus("complete");
    expect(await instances.at(-1)!.getOutput()).not.toHaveProperty("action");
    const s = await first.snapshot();
    expect(s.approvals.map((a) => [a.id, a.status])).toEqual([[approvals[0]!.id, "pending"]]);
    expect(s.timeline.some((t) => t.type === "proposal_deduped")).toBe(true);
  });

  it("proposeAction is idempotent per run", async () => {
    const { agent, snapshot } = await brokenDemo();
    const { approvals } = await until(cardShown, snapshot);
    const again = await agent.proposeAction(approvals[0]!.runId, "diag-retry");
    expect(again.approvalId).toBe(approvals[0]!.id);
  });
});
