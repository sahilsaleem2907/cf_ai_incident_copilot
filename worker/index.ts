import { routeAgentRequest } from "agents";
import { api } from "./api/router";
import { isId } from "./lib/ids";

export { IncidentAgent } from "./agent/IncidentAgent";
export { DiagnosisWorkflow } from "./workflows/diagnosis";

const notFound = () => new Response("Not found", { status: 404 });

/** `/agents/incident-agent/<32-hex id>` only: other names would create empty Durable Objects. */
function isIncidentPath(request: Request): boolean {
  const [, prefix, agent, name, ...rest] = new URL(request.url).pathname.split("/");
  return prefix === "agents" && agent === "incident-agent" && isId(name) && rest.length === 0;
}

// Only /api/* and /agents/* reach the Worker (run_worker_first); everything else is served from assets.
export default {
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname.startsWith("/agents/")) {
      // WebSockets only: the app never talks to the agent over plain HTTP.
      const routed = await routeAgentRequest(request, env, {
        onBeforeConnect: (req) => (isIncidentPath(req) ? undefined : notFound()),
        onBeforeRequest: () => notFound(),
      });
      return routed ?? notFound();
    }
    return api.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
