import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("GET /api/health", () => {
  it("returns ok", async () => {
    const res = await exports.default.fetch("https://example.com/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns JSON 404 for unknown API routes", async () => {
    const res = await exports.default.fetch("https://example.com/api/nope");
    expect(res.status).toBe(404);
  });
});

describe("DEMO service binding", () => {
  it("reaches DemoAdmin over RPC", async () => {
    expect(await env.DEMO.ping()).toBe("pong");
  });
});
