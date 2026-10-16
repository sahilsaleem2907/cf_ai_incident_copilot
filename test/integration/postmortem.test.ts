import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { POSTMORTEM_WRITTEN_TEXT } from "../../worker/agent/IncidentAgent";
import { incidentAgent } from "../../worker/agent/stub";
import type { Findings } from "../../worker/diagnosis/categories";
import { newId } from "../../worker/lib/ids";
import { BUDGET_GUARD_AT } from "../../worker/loop/budget";
import { connect } from "./helpers/ws";

const TARGET = "https://shop.example.com/";
const findings: Findings = {
  category: "origin_5xx",
  confidence: "high",
  evidence: ["http-1"],
  cause: "The origin returns HTTP 500 on every sample [http-1].",
  next_steps: ["Check the origin's logs."],
  actions: [],
};
const today = () => new Date().toISOString().slice(0, 10);

async function errorOf(p: PromiseLike<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected the call to fail");
}

/** An incident with one finished run and its evidence; resolved unless asked not to be. */
async function incident({ resolve = true } = {}) {
  const id = newId();
  const ws = newId();
  const agent = await incidentAgent(env, id);
  const { runId } = await agent.init({ workspaceId: ws, target: TARGET, origin: "chat", message: "why is shop.example.com down?" });
  const [httpId] = await agent.addPendingChecks(runId!, 1, [{ tool: "http_probe", args: { url: TARGET } }]);
  await agent.recordCheck(httpId!, { evidenceId: httpId!, tool: "http_probe", ok: true, status: "fail", summary: "HTTP 500/500/500 on 3 samples", digest: "{}", raw: { url: TARGET, samples: [] } });
  await agent.setFindings(runId!, findings, "ai");
  await agent.finishRun(runId!, "done");
  if (resolve) await agent.resolve();
  return { id, ws, agent };
}

const runsCounted = async (ws: string) =>
  (await env.DB.prepare("SELECT COALESCE(SUM(count), 0) AS n FROM usage_counters WHERE workspace_id = ? AND kind = 'run'").bind(ws).first<{ n: number }>())!.n;

describe("postmortem (WP-22)", () => {
  afterEach(async () => {
    await env.DB.prepare("DELETE FROM llm_usage WHERE day = ?").bind(today()).run();
  });

  it("is only for resolved incidents", async () => {
    const { agent } = await incident({ resolve: false });
    expect(await errorOf(agent.generatePostmortem())).toContain("not_resolved");
  });

  it("the owner gets streamed, stored markdown: facts by code, story by the (mock) AI", async () => {
    const { id, ws, agent } = await incident();
    const owner = await connect(id, ws);
    const r = await owner.rpc("generatePostmortem");
    expect(r.success).toBe(true);
    const md = (r.result as { markdown: string }).markdown;
    expect(md.split("\n").filter((l) => l.startsWith("#"))).toEqual([
      "# Postmortem: shop.example.com",
      "## Summary",
      "## Impact window",
      "## Detection",
      "## Timeline (UTC)",
      "## Root cause",
      "## Resolution",
      "## Follow-ups",
    ]);
    expect(md).toContain("Mock postmortem");
    expect(md).toContain("Reported in chat: “why is shop.example.com down?”.");
    expect(md).toMatch(/Status investigating → resolved \(resolved by hand\)/);
    expect(md).toContain("[http-1]");
    expect(owner.frames.some((f) => f.type === "delta" && f.messageId === "postmortem")).toBe(true);

    const s = await agent.getSnapshot();
    expect(s.hasPostmortem).toBe(true);
    expect(s.timeline.at(-1)).toMatchObject({ type: "postmortem", detail: { source: "llm" } });
    expect(await agent.getPostmortem()).toMatchObject({ markdown: md });
    expect(await runsCounted(ws)).toBe(1);

    // Stored: a second click returns the same text and isn't charged again.
    const again = await owner.rpc("generatePostmortem");
    expect((again.result as { markdown: string }).markdown).toBe(md);
    expect(await runsCounted(ws)).toBe(1);
    owner.close();
  });

  it("a viewer can read it but not write it", async () => {
    const { id, agent } = await incident();
    const viewer = await connect(id, newId());
    const refused = await viewer.rpc("generatePostmortem");
    expect(refused).toMatchObject({ success: false });
    expect(refused.error).toContain("view-only");
    expect((await viewer.rpc("getPostmortem")).result).toBeNull();
    const { markdown } = await agent.generatePostmortem();
    expect((await viewer.rpc("getPostmortem")).result).toMatchObject({ markdown });
    viewer.close();
  });

  it("uses the template, free, when the budget guard is on", async () => {
    await env.DB.prepare("INSERT INTO llm_usage (day, neurons_est) VALUES (?1, ?2)").bind(today(), BUDGET_GUARD_AT).run();
    const { id, ws, agent } = await incident();
    const owner = await connect(id, ws);
    const md = ((await owner.rpc("generatePostmortem")).result as { markdown: string }).markdown;
    expect(md).toContain("shop.example.com: Origin 5xx (high confidence).");
    expect(md).not.toContain("Mock postmortem");
    expect(owner.frames.some((f) => f.messageId === "postmortem")).toBe(false);
    expect(await runsCounted(ws)).toBe(0);
    expect((await agent.getSnapshot()).timeline.at(-1)).toMatchObject({ type: "postmortem", detail: { source: "template" } });
    owner.close();
  });

  it("a follow-up on a resolved incident can propose the generate_postmortem card; approving writes it", async () => {
    const { agent } = await incident();
    const runId = await agent.startRun("write a postmortem", "followup");
    await agent.setFindings(runId, { ...findings, actions: ["generate_postmortem"] }, "ai");
    const { approvalId, actionId } = await agent.proposeAction(runId, "diag-test-2");
    expect(actionId).toBe("generate_postmortem");
    expect((await agent.getSnapshot()).status).toBe("resolved");

    await agent.approve(approvalId!);
    expect(await agent.executeAction(approvalId!)).toEqual({ ok: true, text: POSTMORTEM_WRITTEN_TEXT });
    expect(await agent.afterAction(runId, approvalId!)).toEqual({ pass: true, text: POSTMORTEM_WRITTEN_TEXT });
    const s = await agent.getSnapshot();
    expect(s).toMatchObject({ status: "resolved", hasPostmortem: true });
    expect(s.approvals[0]).toMatchObject({ actionId: "generate_postmortem", status: "approved", outcome: { ok: true, done: true } });

    // Once written, the card isn't offered again.
    await agent.finishRun(runId, "done");
    const run3 = await agent.startRun("another one?", "followup");
    await agent.setFindings(run3, { ...findings, actions: ["generate_postmortem"] }, "ai");
    expect(await agent.proposeAction(run3, "diag-test-3")).toEqual({ approvalId: null, actionId: null });
  });
});
