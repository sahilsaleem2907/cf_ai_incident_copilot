import { introspectWorkflow, type WorkflowIntrospector } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { incidentAgent } from "../../worker/agent/stub";
import { newId } from "../../worker/lib/ids";
import type { WatchOutcome } from "../../worker/workflows/watch";
import { readWatch, seedWatch } from "./helpers/watches";

/** WatchWorkflow (TDD §8.5): confirm 2 of 3, then open one incident. Sleeps are skipped; the fake internet answers. */
let introspector: WorkflowIntrospector | null = null;
afterEach(async () => {
  await introspector?.dispose();
  introspector = null;
});

async function runWatch(watchId: string): Promise<WatchOutcome> {
  introspector = await introspectWorkflow(env.WATCH_WORKFLOW);
  await introspector.modifyAll((m) => m.disableSleeps());
  await env.WATCH_WORKFLOW.create({ id: `watch-${watchId}-test`, params: { watchId } });
  const [instance] = await introspector.get();
  await instance!.waitForStatus("complete");
  return (await instance!.getOutput()) as WatchOutcome;
}

describe("WatchWorkflow", () => {
  it("a confirmed failure opens a watch incident and links it to the watch", async () => {
    const w = await seedWatch({ url: "https://broken.example.com/" });
    const out = await runWatch(w.id);
    expect(out).toMatchObject({ confirmed: true });
    const incidentId = (out as { incidentId: string }).incidentId;
    expect((await readWatch(w.id))!.open_incident_id).toBe(incidentId);

    const s = await (await incidentAgent(env, incidentId)).getSnapshot();
    expect(s).toMatchObject({ id: incidentId, target: "https://broken.example.com/", origin: "watch", status: "investigating" });
    expect(s.messages[0]).toMatchObject({ role: "system", content: "Scheduled check failed for https://broken.example.com/" });
  });

  it("opens nothing when the re-checks pass (a blip)", async () => {
    const w = await seedWatch({ url: "https://ok.example.com/" });
    expect(await runWatch(w.id)).toEqual({ confirmed: false, reason: "recovered" });
    expect((await readWatch(w.id))!.open_incident_id).toBeNull();
  });

  it("opens no second incident for a watch that already has one, or for a deleted watch", async () => {
    const w = await seedWatch({ url: "https://broken.example.com/", open_incident_id: newId() });
    expect(await runWatch(w.id)).toEqual({ confirmed: false, reason: "already_open" });
    await introspector!.dispose();
    expect(await runWatch(newId())).toEqual({ confirmed: false, reason: "gone" });
  });
});
