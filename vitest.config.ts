import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Stand-in for the demo Worker behind the main Worker's DEMO binding. Modes live in memory, and every
// setMode is recorded so tests can assert on what the main Worker asked for (calls()). The real demo
// service is tested in the "demo" project.
const demoStub = `
import { WorkerEntrypoint } from "cloudflare:workers";
const modes = new Map();
const calls = [];
export class DemoAdmin extends WorkerEntrypoint {
  ping() { return "pong"; }
  getMode(ws) { return modes.get(ws) ?? "healthy"; }
  setMode(ws, mode) { calls.push({ ws, mode }); modes.set(ws, mode); return mode; }
  calls(ws) { return calls.filter((c) => c.ws === ws); }
  fetch(request) { return new Response("demo stub " + new URL(request.url).pathname); }
}
export default { fetch() { return new Response("demo stub"); } };
`;

// The integration project's only "internet" (outboundService): DoH answers for *.example.com and a few
// test sites, so Workflow runs are offline and deterministic. nxdomain.example.com doesn't exist,
// broken.example.com returns 500, every other *.example.com host serves a small HTML page.
const fakeInternet = `
const dns = (body) => new Response(JSON.stringify(body), { headers: { "content-type": "application/dns-json" } });
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.hostname === "cloudflare-dns.com" || url.hostname === "dns.google") {
      const name = (url.searchParams.get("name") || "").replace(/\\.$/, "");
      if (!name.endsWith("example.com") || name === "nxdomain.example.com") return dns({ Status: 3 });
      const a = url.searchParams.get("type") === "A";
      return dns({ Status: 0, Answer: a ? [{ name, type: 1, TTL: 300, data: "93.184.215.14" }] : [] });
    }
    if (url.hostname === "broken.example.com") return new Response("upstream exploded", { status: 500 });
    if (url.hostname.endsWith("example.com")) return new Response("<html><body>ok</body></html>", { headers: { "content-type": "text/html" } });
    return new Response("fake internet: unknown host " + url.hostname, { status: 502 });
  },
};
`;

export default defineConfig({
  test: {
    projects: [
      {
        test: { name: "unit", include: ["test/unit/**/*.test.ts"], environment: "node" },
      },
      {
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: "./wrangler.jsonc" },
            // The AI binding is remote by default: tests must not need a login or spend neurons.
            remoteBindings: false,
            miniflare: {
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations("./migrations"),
                LLM_MODE: "mock",
                DEMO_BASE_URL: "https://incident-copilot-demo.test.workers.dev",
                // Runs start only when a test calls launchRun, so agent tests can drive runs by hand.
                DIAGNOSIS_AUTOSTART: "off",
              },
              outboundService: "fake-internet",
              workers: [
                { name: "incident-copilot-demo", modules: true, script: demoStub, compatibilityDate: "2026-10-01" },
                { name: "fake-internet", modules: true, script: fakeInternet, compatibilityDate: "2026-10-01" },
              ],
            },
          })),
        ],
        test: {
          name: "integration",
          include: ["test/integration/**/*.test.ts"],
          setupFiles: ["./test/integration/setup.ts"],
        },
      },
      {
        plugins: [cloudflareTest({ wrangler: { configPath: "./demo-service/wrangler.jsonc" } })],
        test: { name: "demo", include: ["test/demo/**/*.test.ts"] },
      },
    ],
  },
});
