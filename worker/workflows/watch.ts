import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { incidentAgent } from "../agent/stub";
import { newId } from "../lib/ids";
import { devAllowOrigin } from "../safety/ssrf";
import { quickCheck } from "../tools/quickcheck";
import type { WatchParams } from "../watch/cron";
import { claimIncident, getWatch } from "../watch/store";
import { startNotify } from "./notify";

/** Re-checks after cron's failure: one more failure confirms it (2 of 3, FR-42). */
const RECHECKS = 2;
const RECHECK_GAP = "30 seconds";

export type WatchOutcome = { confirmed: false; reason: "gone" | "recovered" | "already_open" } | { confirmed: true; incidentId: string };

/**
 * Confirm → open → notify (TDD §8.5). A plain WorkflowEntrypoint (D3): cron starts it, nothing waits on it. The
 * incident's diagnosis starts from `init`; the webhook (if any) goes out from a NotifyWorkflow.
 */
export class WatchWorkflow extends WorkflowEntrypoint<Env, WatchParams> {
  override async run(event: WorkflowEvent<WatchParams>, step: WorkflowStep): Promise<WatchOutcome> {
    const env = this.env;
    const retries = { retries: { limit: 2, delay: "1 second" as const, backoff: "exponential" as const } };

    const watch = await step.do("load", retries, async () => {
      const w = await getWatch(env.DB, event.payload.watchId);
      if (!w || w.expires_at <= Date.now()) return null;
      return { id: w.id, url: w.url, workspaceId: w.workspace_id, openIncidentId: w.open_incident_id };
    });
    if (!watch) return { confirmed: false, reason: "gone" };
    if (watch.openIncidentId) return { confirmed: false, reason: "already_open" };

    let confirmed = false;
    for (let n = 1; n <= RECHECKS && !confirmed; n++) {
      await step.sleep(`wait-${n}`, RECHECK_GAP);
      const pass = await step.do(`recheck-${n}`, retries, async () => {
        const allowOrigin = devAllowOrigin(env);
        return (await quickCheck(watch.url, { fetch: (input, init) => fetch(input, init), ...(allowOrigin ? { allowOrigin } : {}) })).pass;
      });
      confirmed = !pass;
    }
    if (!confirmed) return { confirmed: false, reason: "recovered" };

    // Its own step, so a retried "open" reuses the ID: the claim then recognises it, and init is idempotent.
    const incidentId = await step.do("incident-id", async () => newId());
    const opened = await step.do("open", retries, async () => {
      if (!(await claimIncident(env.DB, watch.id, incidentId))) {
        // Another failure's Workflow got there first, unless this is a retry of our own claim.
        if ((await getWatch(env.DB, watch.id))?.open_incident_id !== incidentId) return false;
      }
      await (await incidentAgent(env, incidentId)).init({ workspaceId: watch.workspaceId, target: watch.url, origin: "watch", watchId: watch.id });
      return true;
    });
    // The message goes out once the diagnosis is in (NotifyWorkflow waits for it); its ID makes it once only.
    if (opened) await step.do("notify", async () => startNotify(env, incidentId, "opened"));
    return opened ? { confirmed: true, incidentId } : { confirmed: false, reason: "already_open" };
  }
}
