import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("GET /api/health", () => {
  it("returns ok and a version without minting a workspace", async () => {
    const res = await exports.default.fetch("https://example.com/api/health");
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toEqual([]);
    const body = await res.json<{ ok: boolean; version: string }>();
    expect(body.ok).toBe(true);
    expect(typeof body.version).toBe("string");
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
