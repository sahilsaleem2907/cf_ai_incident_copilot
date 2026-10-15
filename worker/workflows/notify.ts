import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { incidentAgent } from "../agent/stub";
import type { Category } from "../diagnosis/categories";
import { webhookKey } from "../notify/crypto";
import { formatMessage, incidentLink, loadWebhook, sendWebhook, type NotifyEvent } from "../notify/webhook";

export type NotifyParams = { incidentId: string; event: NotifyEvent };
export type NotifyOutcome = { sent: boolean; reason?: "no_webhook" | "unknown_incident" | "rejected" };

/** "opened" waits for the first diagnosis, so the message carries the likely cause (user decision, WP-19). */
const DIAGNOSIS_POLLS = 9;
const DIAGNOSIS_POLL_GAP = "10 seconds";

/** `notify-<incidentId>-<event>`: a second create for the same state is a duplicate, so it sends at most once (D18, FR-54). */
export const notifyWorkflowId = (incidentId: string, event: NotifyEvent) => `notify-${incidentId}-${event}`;

/** Starts a NotifyWorkflow; a duplicate ID is ignored. Logged, never thrown: a notification never breaks the caller. */
export async function startNotify(env: Pick<Env, "NOTIFY_WORKFLOW">, incidentId: string, event: NotifyEvent): Promise<void> {
  try {
    await env.NOTIFY_WORKFLOW.create({ id: notifyWorkflowId(incidentId, event), params: { incidentId, event } satisfies NotifyParams });
  } catch (e) {
    if (!/already exists|duplicate/i.test((e as Error).message)) console.error("could not start the notify workflow", incidentId, event, (e as Error).message);
  }
}

/**
 * Sends one Slack/Discord message for a watched incident's state change (TDD §8.5, D18). A plain
 * WorkflowEntrypoint: one retried step does the sending, so a crash or a 5xx doesn't lose or repeat the message.
 */
export class NotifyWorkflow extends WorkflowEntrypoint<Env, NotifyParams> {
  override async run(event: WorkflowEvent<NotifyParams>, step: WorkflowStep): Promise<NotifyOutcome> {
    const env = this.env;
    const { incidentId, event: kind } = event.payload;

    const workspaceId = await step.do("load", async () => {
      const row = await env.DB.prepare("SELECT workspace_id FROM incidents_index WHERE id = ?1").bind(incidentId).first<{ workspace_id: string }>();
      return row?.workspace_id ?? null;
    });
    if (!workspaceId) return { sent: false, reason: "unknown_incident" };
    const hasWebhook = await step.do("has-webhook", async () => !!(await env.DB.prepare("SELECT 1 FROM webhooks WHERE workspace_id = ?1").bind(workspaceId).first()));
    if (!hasWebhook) return { sent: false, reason: "no_webhook" };

    if (kind === "opened") {
      for (let n = 1; n <= DIAGNOSIS_POLLS; n++) {
        const running = await step.do(`diagnosis-${n}`, async () => (await (await incidentAgent(env, incidentId)).getSnapshot()).activeRunId !== null);
        if (!running) break;
        await step.sleep(`wait-${n}`, DIAGNOSIS_POLL_GAP);
      }
    }

    const result = await step.do("send", { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" }, timeout: "30 seconds" }, async () => {
      const key = await webhookKey(env);
      const hook = key ? await loadWebhook(env.DB, key, workspaceId) : null;
      if (!hook) return { sent: false, reason: "no_webhook" as const };
      const s = await (await incidentAgent(env, incidentId)).getSnapshot();
      const body = formatMessage(hook.kind, {
        event: kind,
        target: s.target,
        category: s.category as Category | null,
        cause: s.findings?.cause ?? null,
        link: incidentLink(hook.appOrigin, incidentId),
      });
      // Retryable failures throw here, so the step retries; a 4xx is final.
      const r = await sendWebhook(hook.url, body);
      if (!r.sent) console.warn("webhook refused the message", incidentId, kind, r.status);
      return r.sent ? { sent: true } : { sent: false, reason: "rejected" as const };
    });
    return result;
  }
}
