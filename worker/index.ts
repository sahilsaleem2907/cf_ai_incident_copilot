import { Hono } from "hono";
import { health } from "./api/health";
import type { AppEnv } from "./env";

// Only /api/* and /agents/* reach the Worker (run_worker_first); everything else is served from assets.
const app = new Hono<AppEnv>();
app.route("/api/health", health);
app.notFound((c) => c.json({ error: "not_found" }, 404));

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
