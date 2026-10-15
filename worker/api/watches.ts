import { Hono } from "hono";
import { isOwnDemo } from "../actions/catalog";
import type { AppEnv } from "../env";
import { isId } from "../lib/ids";
import { LIMITS } from "../lib/limits";
import { checkUrlShape, devAllowOrigin } from "../safety/ssrf";
import { parseTarget } from "../safety/target";
import { createWatch, deleteWatch, listWatches, toView } from "../watch/store";
import { demoTarget } from "./session";

const MAX_INPUT = 2000;

/** Our own demo is checked every minute; real sites every 5 minutes or more, at most hourly (TDD §5.2). */
export function watchInterval(url: string, workspaceId: string, demoBaseUrl: string, requested: unknown): number {
  if (isOwnDemo(url, workspaceId, demoBaseUrl)) return LIMITS.demoWatchIntervalSec;
  const n = typeof requested === "number" && Number.isFinite(requested) ? Math.round(requested) : LIMITS.watchMinIntervalSec;
  return Math.min(LIMITS.watchMaxIntervalSec, Math.max(LIMITS.watchMinIntervalSec, n));
}

/** The workspace's watchlist (TDD §7.1, FR-40). Quick checks run from cron, never from these routes. */
export const watches = new Hono<AppEnv>()
  .get("/", async (c) => c.json((await listWatches(c.env.DB, c.get("workspaceId"))).map(toView)))
  .post("/", async (c) => {
    const ws = c.get("workspaceId");
    const body = await c.req.json<{ url?: unknown; intervalSec?: unknown }>().catch(() => ({}) as { url?: unknown; intervalSec?: unknown });
    const input = typeof body.url === "string" ? body.url.trim().slice(0, MAX_INPUT) : "";
    const demoUrl = demoTarget(c.env.DEMO_BASE_URL, ws);
    // Same parser as the chat: a URL, a hostname, or "demo".
    const target = parseTarget(input, demoUrl ?? "https://demo.invalid/");
    if (!target.ok) return c.json({ error: "invalid_url", message: "Give a URL or a hostname, like example.com, or say “demo”." }, 400);
    if (target.source === "demo" && !demoUrl) return c.json({ error: "demo_unavailable" }, 503);
    // The shape check refuses IP literals, localhost and odd ports up front; cron's quickCheck re-checks DNS.
    const shape = checkUrlShape(target.url, devAllowOrigin(c.env));
    if (!shape.ok) return c.json({ error: "invalid_url", message: shape.message }, 400);

    const r = await createWatch(c.env.DB, { workspaceId: ws, url: target.url, intervalSec: watchInterval(target.url, ws, c.env.DEMO_BASE_URL, body.intervalSec) });
    if (!r.ok) return c.json({ error: r.error }, 409);
    return c.json(toView(r.watch), 201);
  })
  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    if (!isId(id) || !(await deleteWatch(c.env.DB, c.get("workspaceId"), id))) return c.json({ error: "not_found" }, 404);
    return c.body(null, 204);
  });
