import { routeAgentRequest } from "agents";
import { api } from "./api/router";
import { isId } from "./lib/ids";
import { runWatchTick } from "./watch/cron";

export { IncidentAgent } from "./agent/IncidentAgent";
export { DiagnosisWorkflow } from "./workflows/diagnosis";
export { WatchWorkflow } from "./workflows/watch";

const notFound = () => new Response("Not found", { status: 404 });

/** `/agents/incident-agent/<32-hex id>` only: other names would create empty Durable Objects. */
function isIncidentPath(request: Request): boolean {
  const [, prefix, agent, name, ...rest] = new URL(request.url).pathname.split("/");
  return prefix === "agents" && agent === "incident-agent" && isId(name) && rest.length === 0;
}

/**
 * True only when `DEMO_BASE_URL` is this Worker's own origin, i.e. local dev: under Vite the demo Worker has no
 * port of its own, so `/w/*` is passed through the DEMO binding. Deployed, the demo has its own workers.dev URL
 * and `/w/*` here is a 404 (TDD §7.5).
 */
function isLocalDemo(url: URL, env: Env): boolean {
  return URL.canParse(env.DEMO_BASE_URL) && new URL(env.DEMO_BASE_URL).origin === url.origin;
}

// Only /api/*, /agents/* and /w/* reach the Worker (run_worker_first); everything else is served from assets.
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/w/")) return isLocalDemo(url, env) ? env.DEMO.fetch(request) : notFound();
    if (url.pathname.startsWith("/agents/")) {
      // WebSockets only: the app never talks to the agent over plain HTTP.
      const routed = await routeAgentRequest(request, env, {
        onBeforeConnect: (req) => (isIncidentPath(req) ? undefined : notFound()),
        onBeforeRequest: () => notFound(),
      });
      return routed ?? notFound();
    }
    return api.fetch(request, env, ctx);
  },
  /** Cron, every minute: check due watches (TDD §8.5). */
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      runWatchTick(env).then(
        (s) => (s.checked || s.expired) && console.log("watch tick", JSON.stringify(s)),
        (e) => console.error("watch tick failed", (e as Error).message),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
