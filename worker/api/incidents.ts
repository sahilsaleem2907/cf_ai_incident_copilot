import { Hono } from "hono";
import { incidentAgent } from "../agent/stub";
import type { AppEnv } from "../env";
import { isId, newId } from "../lib/ids";
import { takeRun } from "../safety/quota";
import { parseTarget } from "../safety/target";
import { demoTarget } from "./session";

type IndexRow = { id: string; target: string; status: string; origin: string; unread: number; updated_at: number };

const MAX_MESSAGE = 2000;

/** Incident API (TDD §7.1). Every route is scoped to the caller's workspace cookie. */
export const incidents = new Hono<AppEnv>()
  .post("/", async (c) => {
    const body = await c.req.json<{ message?: unknown }>().catch(() => ({}) as { message?: unknown });
    const message = typeof body.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE) : "";
    if (!message) return c.json({ error: "empty_message" }, 400);
    const workspaceId = c.get("workspaceId");
    const demoUrl = demoTarget(c.env.DEMO_BASE_URL, workspaceId);
    const target = parseTarget(message, demoUrl ?? "https://demo.invalid/");
    if (target.ok && target.source === "demo" && !demoUrl) return c.json({ error: "demo_unavailable" }, 503);
    if (!target.ok) return c.json({ error: target.error }, 400);
    const quota = await takeRun(c.env, workspaceId);
    if (!quota.ok) return c.json({ error: "rate_limited", retryAfter: quota.retryAfter }, 429, { "Retry-After": String(quota.retryAfter) });
    // `?smoke=rule` skips the LLM (TDD §15): the deploy smoke test costs no neurons. It can only make a run cheaper.
    const mode = c.req.query("smoke") === "rule" ? "rule_based" : "ai";
    const id = newId();
    const agent = await incidentAgent(c.env, id);
    await agent.init({ workspaceId, target: target.url, origin: "chat", message, mode });
    return c.json({ id });
  })
  .get("/", async (c) => {
    const { results } = await c.env.DB.prepare(
      "SELECT id, target, status, origin, unread, updated_at FROM incidents_index WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 50",
    )
      .bind(c.get("workspaceId"))
      .all<IndexRow>();
    return c.json(results.map((r) => ({ id: r.id, target: r.target, status: r.status, origin: r.origin, unread: r.unread === 1, updatedAt: r.updated_at })));
  })
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    if (!(await owns(c.env.DB, c.get("workspaceId"), id))) return c.json({ error: "not_found" }, 404);
    const agent = await incidentAgent(c.env, id);
    return c.json(await agent.getSnapshot());
  })
  .post("/:id/read", async (c) => {
    const id = c.req.param("id");
    if (!(await owns(c.env.DB, c.get("workspaceId"), id))) return c.json({ error: "not_found" }, 404);
    await (await incidentAgent(c.env, id)).markRead();
    return c.body(null, 204);
  });

async function owns(db: D1Database, workspaceId: string, id: string): Promise<boolean> {
  if (!isId(id)) return false;
  return !!(await db.prepare("SELECT 1 FROM incidents_index WHERE id = ? AND workspace_id = ?").bind(id, workspaceId).first());
}
