import { introspectWorkflow, type WorkflowIntrospector } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { incidentAgent } from "../../worker/agent/stub";
import type { Findings } from "../../worker/diagnosis/categories";
import { newId } from "../../worker/lib/ids";
import { notifyWorkflowId, startNotify, type NotifyOutcome } from "../../worker/workflows/notify";
import { seedWatch } from "./helpers/watches";

/**
 * Notifications (TDD §8.5, §11, D18): the webhook API, and NotifyWorkflow sending at most once per state change.
 * The fake internet records Slack/Discord POSTs (vitest.config.ts); each test uses its own webhook path.
 */
const BASE = "https://copilot.example.com";
let introspector: WorkflowIntrospector | null = null;
afterEach(async () => {
  await introspector?.dispose();
  introspector = null;
});

type Call = { host: string; path: string; body: { content?: string; text?: string } };
const callsTo = async (path: string): Promise<Call[]> => ((await (await fetch("https://discord.com/__calls")).json()) as Call[]).filter((c) => c.path === path);

async function workspace(): Promise<{ cookie: string; ws: string }> {
  const res = await exports.default.fetch(`${BASE}/api/session`);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("__Host-ws="))!.split(";")[0]!;
  return { cookie, ws: cookie.split("=")[1]! };
}
const call = (cookie: string, method: string, path = "", body?: unknown) =>
  exports.default.fetch(`${BASE}/api/webhook${path}`, {
    method,
    headers: { Cookie: cookie, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** A workspace with a Discord webhook whose path ends in `suffix` (the fake internet answers by suffix). */
async function withWebhook(suffix = "token") {
  const { cookie, ws } = await workspace();
  const path = `/api/webhooks/${newId()}/${suffix}`;
  expect((await call(cookie, "PUT", "", { url: `https://discord.com${path}` })).status).toBe(200);
  return { cookie, ws, path };
}

const broken: Findings = { category: "origin_5xx", confidence: "high", evidence: ["http-1"], cause: "The origin returns 500 [http-1].", next_steps: [], actions: [] };

/** A watch-opened incident in `ws`, its first run finished with findings. */
async function watchIncident(ws: string) {
  const id = newId();
  const w = await seedWatch({ workspace_id: ws, url: "https://broken.example.com/", open_incident_id: id });
  const agent = await incidentAgent(env, id);
  const { runId } = await agent.init({ workspaceId: ws, target: w.url, origin: "watch", watchId: w.id });
  await agent.setFindings(runId!, broken);
  await agent.finishRun(runId!, "done");
  return { id, agent };
}

async function notifyRuns() {
  introspector = await introspectWorkflow(env.NOTIFY_WORKFLOW);
  await introspector.modifyAll(async (m) => {
    await m.disableSleeps();
    await m.disableRetryDelays();
  });
  return introspector;
}

async function outputs(i: WorkflowIntrospector): Promise<NotifyOutcome[]> {
  const out = [];
  for (const instance of await i.get()) {
    await instance.waitForStatus("complete");
    out.push((await instance.getOutput()) as NotifyOutcome);
  }
  return out;
}

describe("/api/webhook (FR-52, FR-53)", () => {
  it("stores the URL encrypted, shows it masked, and removes it", async () => {
    const { cookie, ws } = await workspace();
    const url = `https://discord.com/api/webhooks/${newId()}/secretTOKEN`;
    const res = await call(cookie, "PUT", "", { url });
    expect(await res.json()).toEqual({ kind: "discord", hint: "discord.com/…/••••OKEN" });
    expect(await (await call(cookie, "GET")).json()).toEqual({ available: true, webhook: { kind: "discord", hint: "discord.com/…/••••OKEN" } });

    const row = await env.DB.prepare("SELECT * FROM webhooks WHERE workspace_id = ?1").bind(ws).first<Record<string, unknown>>();
    expect(row).toMatchObject({ kind: "discord", app_origin: BASE });
    expect(JSON.stringify(row)).not.toContain("secretTOKEN");

    expect((await call(cookie, "DELETE")).status).toBe(204);
    expect(await (await call(cookie, "GET")).json()).toEqual({ available: true, webhook: null });
  });

  it("refuses a URL that isn't a Slack or Discord webhook", async () => {
    const { cookie } = await workspace();
    const res = await call(cookie, "PUT", "", { url: "https://example.com/hook" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_webhook", message: expect.stringContaining("Slack") });
  });

  it("sends a test message, at most 5 an hour", async () => {
    const { cookie, path } = await withWebhook();
    expect(await (await call(cookie, "POST", "/test")).json()).toEqual({ sent: true });
    const [c] = await callsTo(path);
    expect(c!.body.content).toContain("this webhook works");
    for (let i = 0; i < 4; i++) expect((await call(cookie, "POST", "/test")).status).toBe(200);
    expect((await call(cookie, "POST", "/test")).status).toBe(429);
    expect(await callsTo(path)).toHaveLength(5);
    expect((await call((await workspace()).cookie, "POST", "/test")).status).toBe(404);
  });
});

describe("NotifyWorkflow (FR-54, D18)", () => {
  it("a watched incident sends once per state change: opened (with the cause), recovering, resolved", async () => {
    const { ws, path } = await withWebhook();
    const { id, agent } = await watchIncident(ws);
    const i = await notifyRuns();

    await startNotify(env, id, "opened");
    await agent.reportWatchCheck(true, 1, "HTTP 200 in 40 ms");
    await agent.reportWatchCheck(true, 2, "HTTP 200 in 40 ms");
    await agent.reportWatchCheck(true, 3, "HTTP 200 in 40 ms");
    // A repeat for a state that already sent: same ID, so nothing new.
    await startNotify(env, id, "mitigated");
    await startNotify(env, id, "opened");

    expect(await outputs(i)).toEqual([{ sent: true }, { sent: true }, { sent: true }]);
    // The three Workflows run side by side, so the messages can arrive in any order: one of each.
    const sent = (await callsTo(path)).map((c) => c.body.content!);
    expect(sent).toHaveLength(3);
    const opened = sent.filter((t) => t.includes("Watch alert: broken.example.com is failing"));
    expect(opened).toHaveLength(1);
    expect(opened[0]).toContain("Likely cause (origin 5xx): The origin returns 500.");
    expect(opened[0]).toContain(`${BASE}/i/${id}`);
    expect(sent.filter((t) => t.includes("broken.example.com is recovering"))).toHaveLength(1);
    expect(sent.filter((t) => t.includes("broken.example.com is resolved"))).toHaveLength(1);
    expect(await env.NOTIFY_WORKFLOW.get(notifyWorkflowId(id, "resolved"))).toBeTruthy();
  });

  it("sends nothing without a webhook, or for a chat incident with no watch", async () => {
    const { ws } = await workspace();
    const { id } = await watchIncident(ws);
    const i = await notifyRuns();
    await startNotify(env, id, "resolved");
    expect(await outputs(i)).toEqual([{ sent: false, reason: "no_webhook" }]);

    const { ws: ws2 } = await withWebhook();
    const chat = await incidentAgent(env, newId());
    const r = await chat.init({ workspaceId: ws2, target: "https://ok.example.com/", origin: "chat", message: "why?" });
    await chat.finishRun(r.runId!, "done");
    await chat.reportWatchCheck(true, 1, "HTTP 200");
    expect((await chat.getSnapshot()).status).toBe("mitigated");
    expect(await i.get()).toHaveLength(1);
  });

  it("retries a 5xx, and gives up on a 4xx (a deleted webhook)", async () => {
    const flaky = await withWebhook("flaky");
    const gone = await withWebhook("gone");
    const a = await watchIncident(flaky.ws);
    const b = await watchIncident(gone.ws);
    const i = await notifyRuns();
    await startNotify(env, a.id, "resolved");
    await startNotify(env, b.id, "resolved");
    expect(await outputs(i)).toEqual([{ sent: true }, { sent: false, reason: "rejected" }]);
    expect(await callsTo(flaky.path)).toHaveLength(2);
    expect(await callsTo(gone.path)).toHaveLength(1);
  });
});

describe("unread (FR-50)", () => {
  const unread = async (id: string) => (await env.DB.prepare("SELECT unread FROM incidents_index WHERE id = ?1").bind(id).first<{ unread: number }>())?.unread;

  it("an automatic status change marks the incident unread; markRead clears it", async () => {
    const { ws } = await workspace();
    const { id, agent } = await watchIncident(ws);
    await agent.markRead();
    expect(await unread(id)).toBe(0);
    await agent.reportWatchCheck(true, 1, "HTTP 200");
    expect(await unread(id)).toBe(1);
    await agent.markRead();
    expect(await unread(id)).toBe(0);
    // A check that changes nothing isn't new activity.
    await agent.reportWatchCheck(true, 2, "HTTP 200");
    expect(await unread(id)).toBe(0);
  });
});
