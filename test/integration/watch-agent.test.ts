import { introspectWorkflow, type WorkflowIntrospector } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import type { IncidentState } from "../../worker/agent/state";
import { incidentAgent } from "../../worker/agent/stub";
import type { Findings } from "../../worker/diagnosis/categories";
import { newId } from "../../worker/lib/ids";
import { clearWatches, readWatch, seedWatch } from "./helpers/watches";

/** The agent's side of watching (TDD §7.6, §8.4–§8.5): reportWatchCheck, and the add_to_watchlist card. */
let introspector: WorkflowIntrospector | null = null;
afterEach(async () => {
  await introspector?.dispose();
  introspector = null;
});

const statuses = (s: IncidentState) => s.timeline.filter((t) => t.type === "status").map((t) => t.detail.to);

async function watchIncident() {
  const id = newId();
  const w = await seedWatch({ url: "https://broken.example.com/", open_incident_id: id });
  const agent = await incidentAgent(env, id);
  const { runId } = await agent.init({ workspaceId: w.workspace_id, target: w.url, origin: "watch", watchId: w.id });
  await agent.finishRun(runId!, "done");
  return { id, w, agent, runId: runId! };
}

const broken: Findings = { category: "origin_5xx", confidence: "high", evidence: ["http-1"], cause: "The origin returns 500 [http-1].", next_steps: [], actions: [] };

describe("reportWatchCheck", () => {
  it("a pass while investigating → mitigated; 3 in a row → resolved, which frees the watch", async () => {
    const { w, agent } = await watchIncident();
    await agent.reportWatchCheck(true, 1, "HTTP 200 in 40 ms");
    expect((await agent.getSnapshot()).status).toBe("mitigated");
    await agent.reportWatchCheck(true, 2, "HTTP 200 in 40 ms");
    expect((await agent.getSnapshot()).status).toBe("mitigated");
    await agent.reportWatchCheck(true, 3, "HTTP 200 in 40 ms");
    const s = await agent.getSnapshot();
    expect(s.status).toBe("resolved");
    expect(statuses(s)).toEqual(["mitigated", "resolved"]);
    expect((await readWatch(w.id))!.open_incident_id).toBeNull();
    // Nothing more happens once resolved.
    await agent.reportWatchCheck(false, 0, "Failing: http_500");
    expect((await agent.getSnapshot()).status).toBe("resolved");
  });

  it("a failure reopens a mitigated incident; a failure while investigating changes nothing", async () => {
    const { agent } = await watchIncident();
    await agent.reportWatchCheck(false, 0, "Failing: http_500");
    expect((await agent.getSnapshot()).status).toBe("investigating");
    await agent.reportWatchCheck(true, 1, "HTTP 200 in 40 ms");
    await agent.reportWatchCheck(false, 0, "Failing: http_500");
    const s = await agent.getSnapshot();
    expect(statuses(s)).toEqual(["mitigated", "investigating"]);
    expect(s.timeline.filter((t) => t.type === "watch_check")).toHaveLength(3);
  });

  it("leaves a pending card alone", async () => {
    await clearWatches();
    const { agent, runId } = await watchIncident();
    // The incident's own watch makes add_to_watchlist unproposable, so use a fresh chat incident for a card.
    const chat = await incidentAgent(env, newId());
    const r = await chat.init({ workspaceId: newId(), target: "https://broken.example.com/", origin: "chat", message: "why?" });
    await chat.setFindings(r.runId!, broken);
    expect(await chat.proposeAction(r.runId!, "wf-test")).toMatchObject({ actionId: "add_to_watchlist" });
    await chat.reportWatchCheck(true, 1, "HTTP 200 in 40 ms");
    expect((await chat.getSnapshot()).status).toBe("awaiting_approval");
    // And the watch incident itself gets no card: it's already watched.
    await agent.setFindings(runId, broken);
    expect(await agent.proposeAction(runId, "wf-test")).toEqual({ approvalId: null, actionId: null });
  });
});

describe("add_to_watchlist (user decision, WP-18)", () => {
  it("a broken real site gets the card; approving links a new watch, and its passes resolve the incident", async () => {
    await clearWatches();
    introspector = await introspectWorkflow(env.DIAGNOSIS_WORKFLOW);
    const ws = newId();
    const id = newId();
    const agent = await incidentAgent(env, id);
    const { runId } = await agent.init({ workspaceId: ws, target: "https://broken.example.com/", origin: "chat", message: "why is broken.example.com down?" });
    await agent.launchRun(runId!);
    const [instance] = await introspector.get();
    let s = await agent.getSnapshot();
    for (const end = Date.now() + 8000; !(s.approvals.length && s.activeRunId === null) && Date.now() < end; s = await agent.getSnapshot()) await new Promise((r) => setTimeout(r, 50));
    expect(s.approvals[0]).toMatchObject({ actionId: "add_to_watchlist", title: "Add this endpoint to the watchlist", status: "pending" });

    await agent.approve(s.approvals[0]!.id);
    await instance!.waitForStatus("complete");
    s = await agent.getSnapshot();
    expect(s.status).toBe("investigating");
    expect(s.approvals[0]).toMatchObject({ status: "approved", outcome: { ok: true, done: true } });
    expect(s.approvals[0]!.outcome!.text).toMatch(/every 5 minutes for 24 hours/);

    const watch = await env.DB.prepare("SELECT * FROM watches WHERE workspace_id = ?1").bind(ws).first<{ id: string; url: string; interval_sec: number; open_incident_id: string }>();
    expect(watch).toMatchObject({ url: "https://broken.example.com/", interval_sec: 300, open_incident_id: id });

    for (const n of [1, 2, 3]) await agent.reportWatchCheck(true, n, "HTTP 200 in 40 ms");
    expect((await agent.getSnapshot()).status).toBe("resolved");
    expect((await readWatch(watch!.id))!.open_incident_id).toBeNull();
  });

  it("isn't proposed once the workspace's watchlist is full", async () => {
    await clearWatches();
    const ws = newId();
    for (const h of ["a", "b", "c"]) await seedWatch({ workspace_id: ws, url: `https://${h}.example.com/` });
    const agent = await incidentAgent(env, newId());
    const { runId } = await agent.init({ workspaceId: ws, target: "https://broken.example.com/", origin: "chat", message: "why?" });
    await agent.setFindings(runId!, broken);
    expect(await agent.proposeAction(runId!, "wf-test")).toEqual({ approvalId: null, actionId: null });
  });
});
