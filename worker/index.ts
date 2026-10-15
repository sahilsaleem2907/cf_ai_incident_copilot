import { api } from "./api/router";

// Only /api/* and /agents/* reach the Worker (run_worker_first); everything else is served from assets.
// WP-08 adds routeAgentRequest for /agents/* ahead of the API router.
export default {
  fetch: (request, env, ctx) => api.fetch(request, env, ctx),
} satisfies ExportedHandler<Env>;
