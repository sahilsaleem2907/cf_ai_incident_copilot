import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { incidentAgent } from "../../worker/agent/stub";
import type { Findings } from "../../worker/diagnosis/categories";
import { newId } from "../../worker/lib/ids";
import type { ToolResult } from "../../worker/tools/types";
import { connect, type Frame } from "./helpers/ws";

const TARGET = "https://shop.example.com/";

/** The message of a rejected RPC call (awaiting the RPC promise directly). */
async function errorOf(p: PromiseLike<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected the call to fail");
}

async function newIncident(message = "why is shop.example.com down?") {
  const id = newId();
  const ws = newId();
  const agent = await incidentAgent(env, id);
  const { runId } = await agent.init({ workspaceId: ws, target: TARGET, origin: "chat", message });
  return { id, ws, agent, runId: runId! };
}

const http500: Omit<ToolResult, "evidenceId"> = {
  tool: "http_probe",
  ok: true,
  status: "fail",
  summary: "HTTP 500/500/500 on 3 samples · median 40 ms (TTFB 30 ms)",
  digest: '{"url":"https://shop.example.com/","samples":["500 ttfb=30 total=40"]}',
  raw: { url: TARGET, samples: [] },
};
const dnsOk: Omit<ToolResult, "evidenceId"> = {
  tool: "dns_lookup",
  ok: true,
  status: "pass",
  summary: "93.184.215.14 · both resolvers agree",
  digest: '{"host":"shop.example.com","mismatch":false}',
  raw: { hostname: "shop.example.com", cnameTargets: ["shop.example.com.cdn.cloudflare.net"] },
};
const findings: Findings = {
  category: "origin_5xx",
  confidence: "high",
  evidence: ["http-1", "dns-1"],
  cause: "The origin returns HTTP 500 on every sample.",
  next_steps: ["Check the origin's logs."],
  actions: ["restore_demo_service"],
};

/** Plays one Workflow run against the agent: plan → checks → findings. */
async function playRun(agent: Awaited<ReturnType<typeof incidentAgent>>, runId: string, f: Findings = findings, mode: "ai" | "rule_based" = "ai") {
  const ids = await agent.addPendingChecks(runId, 1, [
    { tool: "dns_lookup", args: { hostname: "shop.example.com" } },
    { tool: "http_probe", args: { url: TARGET } },
  ]);
  await agent.recordCheck(ids[0]!, { ...dnsOk, evidenceId: ids[0]! });
  await agent.recordCheck(ids[1]!, { ...http500, evidenceId: ids[1]! });
  await agent.setFindings(runId, f, mode);
  return ids;
}

describe("IncidentAgent: init and runs", () => {
  it("creates the incident, the first run and the index row; init is idempotent", async () => {
    const { id, ws, agent, runId } = await newIncident();
    expect(runId).toBe("run-1");
    const s = await agent.getSnapshot();
    expect(s).toMatchObject({ id, target: TARGET, origin: "chat", status: "investigating", activeRunId: "run-1" });
    expect(s.messages).toEqual([expect.objectContaining({ role: "user", content: "why is shop.example.com down?", runId: "run-1" })]);
    expect(s.timeline.map((t) => t.type)).toEqual(["opened", "run_started"]);

    expect(await agent.init({ workspaceId: newId(), target: "https://other.example.com/", origin: "chat", message: "x" })).toEqual({ runId: "run-1" });
    expect((await agent.getSnapshot()).target).toBe(TARGET);

    const row = await env.DB.prepare("SELECT workspace_id, status, origin FROM incidents_index WHERE id = ?").bind(id).first();
    expect(row).toEqual({ workspace_id: ws, status: "investigating", origin: "chat" });
  });

  it("allows one run at a time (D13)", async () => {
    const { agent, runId } = await newIncident();
    expect(await errorOf(agent.startRun("again?", "followup"))).toContain("run_active");
    await agent.finishRun(runId, "done");
    expect(await agent.startRun("again?", "followup")).toBe("run-2");
  });

  it("allocates evidence IDs per tool and returns the same IDs on a retried step", async () => {
    const { agent, runId } = await newIncident();
    const calls = [
      { tool: "http_probe" as const, args: { url: TARGET } },
      { tool: "http_probe" as const, args: { url: `${TARGET}health` } },
      { tool: "dns_lookup" as const, args: { hostname: "shop.example.com" } },
    ];
    expect(await agent.addPendingChecks(runId, 1, calls)).toEqual(["http-1", "http-2", "dns-1"]);
    expect(await agent.addPendingChecks(runId, 1, calls)).toEqual(["http-1", "http-2", "dns-1"]);
    expect(await agent.addPendingChecks(runId, 2, [calls[0]!])).toEqual(["http-3"]);
    expect((await agent.getSnapshot()).checks.map((c) => [c.evidenceId, c.status, c.label])).toEqual([
      ["http-1", "pending", "HTTP probe"],
      ["http-2", "pending", "HTTP probe"],
      ["dns-1", "pending", "DNS lookup"],
      ["http-3", "pending", "HTTP probe"],
    ]);
  });

  it("records checks idempotently and builds the run context from digests", async () => {
    const { agent, runId } = await newIncident();
    const ids = await playRun(agent, runId);
    await agent.recordCheck(ids[1]!, { ...http500, evidenceId: ids[1]! });
    expect(await errorOf(agent.recordCheck("http-99", { ...http500, evidenceId: "http-99" }))).toContain("unknown evidence id");

    const ctx = await agent.getRunContext(runId);
    expect(ctx).toMatchObject({ runId, target: TARGET, question: "why is shop.example.com down?", kind: "initial", mode: "ai" });
    expect(ctx.evidence.map((e) => e.evidenceId)).toEqual(["dns-1", "http-1"]);
    expect(ctx.evidence[1]).toEqual({ evidenceId: "http-1", tool: "http_probe", status: "fail", summary: http500.summary, digest: http500.digest });
    expect(ctx.scope).toEqual({ host: "shop.example.com", cnameTargets: ["shop.example.com.cdn.cloudflare.net"] });
  });

  it("resolves a chat incident whose first run is healthy (TDD §10)", async () => {
    const { id, agent, runId } = await newIncident();
    await playRun(agent, runId, { ...findings, category: "healthy", actions: [] });
    const s = await agent.getSnapshot();
    expect(s).toMatchObject({ status: "resolved", category: "healthy" });
    expect(s.timeline.at(-1)).toMatchObject({ type: "status", detail: { from: "investigating", to: "resolved" } });
    expect(await env.DB.prepare("SELECT status FROM incidents_index WHERE id = ?").bind(id).first("status")).toBe("resolved");
  });

  it("records which limit ended a run and frees the composer (TDD §8.2)", async () => {
    const { agent, runId } = await newIncident();
    await agent.finishRun(runId, "limit_tools", { toolCalls: 6, llmTurns: 3 });
    await agent.finishRun(runId, "done");
    const s = await agent.getSnapshot();
    expect(s.activeRunId).toBeNull();
    expect(s.timeline.filter((t) => t.type === "run_finished")).toEqual([expect.objectContaining({ detail: { runId, status: "limit_tools" } })]);
  });
});

describe("IncidentAgent: narration", () => {
  it("streams the mock narration to connected sockets and stores cited text", async () => {
    const { id, ws, agent, runId } = await newIncident();
    await playRun(agent, runId);
    const sock = await connect(id, ws);
    await sock.state();

    const out = await agent.narrate(runId);
    expect(out).toEqual({ messageId: `narr-${runId}`, source: "llm" });
    const stream = sock.frames.filter((f) => ["stream_start", "delta", "stream_end"].includes(f.type));
    expect(stream[0]).toEqual({ type: "stream_start", messageId: out.messageId });
    expect(stream.at(-1)).toEqual({ type: "stream_end", messageId: out.messageId });
    const streamed = stream.filter((f): f is Frame & { text: string } => f.type === "delta").map((f) => f.text).join("");
    expect(streamed).toContain("**Likely cause:**");

    const s = await agent.getSnapshot();
    const message = s.messages.find((m) => m.id === out.messageId)!;
    expect(message).toMatchObject({ role: "assistant", runId });
    expect(message.content).toContain("[http-1]");
    expect(await env.DB.prepare("SELECT unread FROM incidents_index WHERE id = ?").bind(id).first("unread")).toBe(1);
    sock.close();
  });

  it("is idempotent per run: a second call doesn't restream or duplicate", async () => {
    const { id, ws, agent, runId } = await newIncident();
    await playRun(agent, runId);
    await agent.narrate(runId);
    const sock = await connect(id, ws);
    await sock.state();
    expect(await agent.narrate(runId)).toEqual({ messageId: `narr-${runId}`, source: "existing" });
    expect(sock.frames.some((f) => f.type === "stream_start")).toBe(false);
    expect((await agent.getSnapshot()).messages.filter((m) => m.role === "assistant")).toHaveLength(1);
    sock.close();
  });

  it("uses the rule template in rule-based mode, without streaming", async () => {
    const { agent, runId } = await newIncident();
    await playRun(agent, runId, findings, "rule_based");
    expect(await agent.narrate(runId)).toMatchObject({ source: "template" });
    const text = (await agent.getSnapshot()).messages.at(-1)!.content;
    expect(text).toContain("- HTTP probe: HTTP 500/500/500 on 3 samples · median 40 ms (TTFB 30 ms) [http-1]");
    expect(text).not.toContain("restore_demo_service");
  });
});

describe("IncidentAgent: roles over WebSocket (D8)", () => {
  it("lets the owner use callables", async () => {
    const { id, ws, agent, runId } = await newIncident();
    const sock = await connect(id, ws);
    expect((await sock.state()).id).toBe(id);

    expect(await sock.rpc("sendMessage", ["and now?"])).toMatchObject({ success: false, error: "run_active" });
    await agent.finishRun(runId, "done");
    expect(await sock.rpc("sendMessage", ["and now?"])).toMatchObject({ success: true, result: { runId: "run-2" } });
    expect(await sock.rpc("markRead")).toMatchObject({ success: true });
    expect(await sock.rpc("resolve")).toMatchObject({ success: true });
    expect((await agent.getSnapshot()).status).toBe("resolved");
    sock.close();
  });

  it("gives a link-only visitor a read-only view", async () => {
    const { id, agent, runId } = await newIncident();
    await playRun(agent, runId);
    const sock = await connect(id, newId());
    expect((await sock.state()).target).toBe(TARGET);

    for (const [method, args] of [["sendMessage", ["hi"]], ["resolve", []], ["markRead", []]] as const) {
      expect(await sock.rpc(method, [...args])).toMatchObject({ success: false, error: expect.stringContaining("view-only") });
    }
    expect(await sock.rpc("getEvidence", ["http-1"])).toMatchObject({ success: true, result: { evidenceId: "http-1", tool: "http_probe" } });
    expect(await sock.rpc("init", [{}])).toMatchObject({ success: false, error: expect.stringContaining("not callable") });
    expect((await agent.getSnapshot()).status).toBe("investigating");
    sock.close();
  });

  it("rejects client-side state writes, even from the owner", async () => {
    const { id, ws, agent } = await newIncident();
    const sock = await connect(id, ws);
    await sock.state();
    sock.send({ type: "cf_agent_state", state: { status: "resolved" } });
    await sock.next((f) => f.type === "cf_agent_state_error");
    expect((await agent.getSnapshot()).status).toBe("investigating");
    sock.close();
  });

  it("refuses names that aren't incident IDs, and plain HTTP to agents", async () => {
    const bad = await exports.default.fetch("https://copilot.example.com/agents/incident-agent/not-an-id", { headers: { Upgrade: "websocket" } });
    expect(bad.status).toBe(404);
    const http = await exports.default.fetch(`https://copilot.example.com/agents/incident-agent/${newId()}`);
    expect(http.status).toBe(404);
  });

  it("closes sockets for an incident that doesn't exist", async () => {
    const sock = await connect(newId(), newId());
    await new Promise((r) => setTimeout(r, 50));
    expect(sock.closed()).toMatchObject({ code: 4404 });
  });
});
