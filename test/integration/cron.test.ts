import { introspectWorkflow, type WorkflowIntrospector } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { incidentAgent } from "../../worker/agent/stub";
import { newId } from "../../worker/lib/ids";
import { runWatchTick, watchWorkflowId } from "../../worker/watch/cron";
import { clearWatches, readWatch, seedWatch } from "./helpers/watches";

/**
 * Watch cron (TDD §8.5, D12) against the fake internet: broken.example.com → 500, other *.example.com → 200.
 * A healthy quick check there costs 3 subrequests (2 guard DoH lookups + 1 GET), plus 1 for the RPC/create.
 */
let introspector: WorkflowIntrospector | null = null;
beforeEach(async () => {
  await clearWatches();
});
afterEach(async () => {
  await introspector?.dispose();
  introspector = null;
});

describe("scheduled() watch checks", () => {
  it("picks due, unexpired watches only, oldest next_run first, at most 6 per tick", async () => {
    const now = Date.now();
    const due = [];
    for (let i = 0; i < 8; i++) due.push(await seedWatch({ next_run: now - 10_000 + i }));
    const later = await seedWatch({ next_run: now + 60_000 });

    const s = await runWatchTick(env, now);
    expect(s).toMatchObject({ checked: 6, failed: 0, started: 0, deferred: 0 });
    for (const w of due.slice(0, 6)) expect(await readWatch(w.id)).toMatchObject({ last_status: "pass", consecutive_passes: 1, next_run: now + 300_000 });
    for (const w of [...due.slice(6), later]) expect((await readWatch(w.id))!.last_status).toBeNull();
  });

  it("stops before the tick's subrequest budget runs out; the rest wait for the next tick", async () => {
    const now = Date.now();
    for (let i = 0; i < 6; i++) await seedWatch({ next_run: now - 10_000 + i });
    // Each costs 4, and a watch needs 12 left: 20 → checks 3 (used 12), then 8 left < 12.
    expect(await runWatchTick(env, now, 20)).toMatchObject({ checked: 3, deferred: 3 });
  });

  it("a failing check with no open incident starts WatchWorkflow with ID watch-<id>-<minute>", async () => {
    introspector = await introspectWorkflow(env.WATCH_WORKFLOW);
    await introspector.modifyAll((m) => m.disableSleeps());
    const now = Date.now();
    const w = await seedWatch({ url: "https://broken.example.com/" });

    expect(await runWatchTick(env, now)).toMatchObject({ checked: 1, failed: 1, started: 1 });
    expect(await readWatch(w.id)).toMatchObject({ last_status: "fail", consecutive_passes: 0 });
    const instance = await env.WATCH_WORKFLOW.get(watchWorkflowId(w.id, now));
    expect(instance.id).toBe(`watch-${w.id}-${Math.floor(now / 60_000)}`);
    const [i] = await introspector.get();
    await i!.waitForStatus("complete");
  });

  it("a duplicate WatchWorkflow ID is ignored, so one failure opens one incident", async () => {
    introspector = await introspectWorkflow(env.WATCH_WORKFLOW);
    await introspector.modifyAll((m) => m.disableSleeps());
    const now = Date.now();
    const w = await seedWatch({ url: "https://broken.example.com/" });
    expect((await runWatchTick(env, now)).started).toBe(1);
    // Due again within the same minute: the same ID, so no second Workflow.
    await env.DB.prepare("UPDATE watches SET next_run = ?2 WHERE id = ?1").bind(w.id, now - 1).run();
    expect(await runWatchTick(env, now)).toMatchObject({ failed: 1, started: 0 });
    expect(await introspector.get()).toHaveLength(1);
    await (await introspector.get())[0]!.waitForStatus("complete");
  });

  it("a check on a watch with an open incident calls reportWatchCheck(pass)", async () => {
    const id = newId();
    const w = await seedWatch({ open_incident_id: id });
    const agent = await incidentAgent(env, id);
    await agent.init({ workspaceId: w.workspace_id, target: w.url, origin: "watch", watchId: w.id });

    expect(await runWatchTick(env)).toMatchObject({ checked: 1, reported: 1, started: 0 });
    const s = await agent.getSnapshot();
    expect(s.timeline.find((t) => t.type === "watch_check")?.detail).toMatchObject({ pass: true, passes: 1 });
    expect(s.status).toBe("mitigated");
  });

  it("expired watches are deleted", async () => {
    const now = Date.now();
    const old = await seedWatch({ expires_at: now - 1 });
    const live = await seedWatch({ next_run: now + 60_000 });
    expect(await runWatchTick(env, now)).toMatchObject({ expired: 1, checked: 0 });
    expect(await readWatch(old.id)).toBeNull();
    expect(await readWatch(live.id)).not.toBeNull();
  });
});
