import { WorkerEntrypoint } from "cloudflare:workers";

/** Admin RPC for the main Worker, reachable only through the DEMO service binding (TDD §7.5). */
export class DemoAdmin extends WorkerEntrypoint {
  ping(): string {
    return "pong";
  }
}

export default {
  async fetch(): Promise<Response> {
    return new Response("Incident Copilot demo service", { headers: { "content-type": "text/plain" } });
  },
} satisfies ExportedHandler;
