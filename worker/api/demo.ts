import { Hono } from "hono";
import { DemoModeSchema } from "../../demo-service/src/modes";
import type { AppEnv } from "../env";
import { demoTarget } from "./session";

/** The caller's demo service (TDD §7.1, §7.5). Modes change only through the DEMO binding, never over HTTP to the demo. */
export const demo = new Hono<AppEnv>()
  .get("/", async (c) => {
    const ws = c.get("workspaceId");
    const url = demoTarget(c.env.DEMO_BASE_URL, ws);
    if (!url) return c.json({ error: "demo_unavailable" }, 503);
    return c.json({ mode: await c.env.DEMO.getMode(ws), url });
  })
  .post("/mode", async (c) => {
    const ws = c.get("workspaceId");
    const url = demoTarget(c.env.DEMO_BASE_URL, ws);
    if (!url) return c.json({ error: "demo_unavailable" }, 503);
    const body = await c.req.json<{ mode?: unknown }>().catch(() => ({}) as { mode?: unknown });
    const parsed = DemoModeSchema.safeParse(body.mode);
    if (!parsed.success) return c.json({ error: "invalid_mode" }, 400);
    return c.json({ mode: await c.env.DEMO.setMode(ws, parsed.data), url });
  });
