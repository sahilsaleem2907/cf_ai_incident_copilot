import { WorkerEntrypoint } from "cloudflare:workers";
import { isId } from "../../worker/lib/ids";
import { DemoModeSchema, type DemoMode } from "./modes";
import { handle } from "./pages";
import type { DemoState } from "./state";

export { DemoState } from "./state";

/** `wrangler types` only generates `Env` for the main Worker, so the demo Worker declares its own. */
type DemoEnv = { DEMO_STATE: DurableObjectNamespace<DemoState> };

function stateFor(env: DemoEnv, ws: string) {
  if (!isId(ws)) throw new Error("invalid_workspace");
  return env.DEMO_STATE.get(env.DEMO_STATE.idFromName(ws));
}

const modeOf = (env: DemoEnv) => (ws: string) => stateFor(env, ws).getMode();

/**
 * Admin RPC for the main Worker, reachable only through the DEMO service binding (TDD §7.5). There's no
 * public admin route. `fetch` serves the same public pages, so the main Worker can pass `/w/*` through in
 * local dev, where the demo has no port of its own.
 */
export class DemoAdmin extends WorkerEntrypoint<DemoEnv> {
  ping(): string {
    return "pong";
  }

  async getMode(ws: string): Promise<DemoMode> {
    return stateFor(this.env, ws).getMode();
  }

  async setMode(ws: string, mode: string): Promise<DemoMode> {
    // A ZodError loses its message over RPC, so callers get a plain code instead.
    const parsed = DemoModeSchema.safeParse(mode);
    if (!parsed.success) throw new Error("invalid_mode");
    return stateFor(this.env, ws).setMode(parsed.data);
  }

  override fetch(request: Request): Promise<Response> {
    return handle(request, modeOf(this.env));
  }
}

export default {
  fetch(request, env) {
    return handle(request, modeOf(env));
  },
} satisfies ExportedHandler<DemoEnv>;
