import { Hono } from "hono";
import type { AppEnv } from "../env";
import { webhookKey } from "../notify/crypto";
import { deleteWebhook, formatMessage, getWebhookInfo, loadWebhook, parseWebhookUrl, putWebhook, RetryableSendError, sendWebhook } from "../notify/webhook";
import { takeWindow } from "../safety/quota";

const TESTS_PER_HOUR = 5;
const HOUR_MS = 3_600_000;

/** The workspace's Slack/Discord webhook (TDD §7.1, §11). The URL goes in once and only ever comes back masked. */
export const webhook = new Hono<AppEnv>()
  // `available`: false when WEBHOOK_KEY isn't set on this deployment, so the UI can say so up front.
  .get("/", async (c) => c.json({ available: !!(await webhookKey(c.env)), webhook: await getWebhookInfo(c.env.DB, c.get("workspaceId")) }))
  .put("/", async (c) => {
    const key = await webhookKey(c.env);
    if (!key) return c.json({ error: "webhooks_unavailable" }, 503);
    const body = await c.req.json<{ url?: unknown }>().catch(() => ({}) as { url?: unknown });
    const parsed = parseWebhookUrl(typeof body.url === "string" ? body.url : "");
    if (!parsed.ok) return c.json({ error: "invalid_webhook", message: parsed.message }, 400);
    // The origin this request came in on: messages link back to the incident here, with no URL in the repo (D2).
    const info = await putWebhook(c.env.DB, key, { workspaceId: c.get("workspaceId"), kind: parsed.kind, url: parsed.url, appOrigin: new URL(c.req.url).origin });
    return c.json(info);
  })
  .delete("/", async (c) => {
    await deleteWebhook(c.env.DB, c.get("workspaceId"));
    return c.body(null, 204);
  })
  .post("/test", async (c) => {
    const ws = c.get("workspaceId");
    const key = await webhookKey(c.env);
    if (!key) return c.json({ error: "webhooks_unavailable" }, 503);
    const hook = await loadWebhook(c.env.DB, key, ws);
    if (!hook) return c.json({ error: "not_found" }, 404);
    const quota = await takeWindow(c.env.DB, ws, "webhook_test", TESTS_PER_HOUR, HOUR_MS, Date.now());
    if (!quota.ok) return c.json({ error: "rate_limited", retryAfter: quota.retryAfter }, 429, { "Retry-After": String(quota.retryAfter) });
    try {
      const r = await sendWebhook(hook.url, formatMessage(hook.kind, { event: "test", target: "" }));
      return r.sent ? c.json({ sent: true }) : c.json({ error: "send_failed", status: r.status }, 502);
    } catch (e) {
      if (e instanceof RetryableSendError) return c.json({ error: "send_failed" }, 502);
      throw e;
    }
  });
