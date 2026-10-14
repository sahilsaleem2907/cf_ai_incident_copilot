import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Stand-in for the demo Worker behind the main Worker's DEMO binding. Integration tests assert on
// what the main Worker asks of it; the real demo service is tested in the "demo" project.
const demoStub = `
import { WorkerEntrypoint } from "cloudflare:workers";
export class DemoAdmin extends WorkerEntrypoint { ping() { return "pong"; } }
export default { fetch() { return new Response("demo stub"); } };
`;

export default defineConfig({
  test: {
    projects: [
      {
        test: { name: "unit", include: ["test/unit/**/*.test.ts"], environment: "node" },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              workers: [
                { name: "incident-copilot-demo", modules: true, script: demoStub, compatibilityDate: "2026-10-01" },
              ],
            },
          }),
        ],
        test: { name: "integration", include: ["test/integration/**/*.test.ts"] },
      },
      {
        plugins: [cloudflareTest({ wrangler: { configPath: "./demo-service/wrangler.jsonc" } })],
        test: { name: "demo", include: ["test/demo/**/*.test.ts"] },
      },
    ],
  },
});
