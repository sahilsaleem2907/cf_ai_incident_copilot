import { Hono } from "hono";
import { incidentAgent } from "../agent/stub";
import type { AppEnv } from "../env";
import { isId, newId } from "../lib/ids";
import { parseTarget, type TargetResult } from "../safety/target";
import { demoUrlFor } from "./session";

type IndexRow = { id: string; target: string; status: string; origin: string; unread: number; updated_at: number };

const MAX_MESSAGE = 2000;

/** Incident API (TDD §7.1). Every route is scoped to the caller's workspace cookie. */
export const incidents = new Hono<AppEnv>()
  .post("/", async (c) => {
    const body = await c.req.json<{ message?: unknown }>().catch(() => ({}) as { message?: unknown });
    const message = typeof body.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE) : "";
    if (!message) return c.json({ error: "empty_message" }, 400);
    const workspaceId = c.get("workspaceId");
    let target: TargetResult;
    try {
      target = parseTarget(message, demoUrlFor(c.env.DEMO_BASE_URL, workspaceId));
    } catch {
      // DEMO_BASE_URL still holds the `<sub>` placeholder (set in WP-11 locally, WP-13 deployed).
      return c.json({ error: "demo_unavailable" }, 503);
    }
    if (!target.ok) return c.json({ error: target.error }, 400);
    // WP-17: run quota (D14) before init.
    const id = newId();
    const agent = await incidentAgent(c.env, id);
    await agent.init({ workspaceId, target: target.url, origin: "chat", message });
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
