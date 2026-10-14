import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const BASE = "https://copilot.example.com";

function wsCookie(res: Response): string | undefined {
  return res.headers.getSetCookie().find((c) => c.startsWith("__Host-ws="));
}

describe("workspace cookie + GET /api/session", () => {
  it("creates a workspace on first visit", async () => {
    const res = await exports.default.fetch(`${BASE}/api/session`);
    expect(res.status).toBe(200);

    const cookie = wsCookie(res);
    expect(cookie).toMatch(/^__Host-ws=[0-9a-f]{32};/);
    expect(cookie).toContain("Max-Age=31536000");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Domain");

    const id = cookie!.slice("__Host-ws=".length, "__Host-ws=".length + 32);
    const body = await res.json<{ demoUrl: string; budgetMode: string; limits: Record<string, number> }>();
    expect(body.demoUrl).toBe(`${env.DEMO_BASE_URL}/w/${id}/`);
    expect(body.budgetMode).toBe("ai");
    expect(body.limits).toMatchObject({ runsPerMinute: 3, runsPerHour: 10 });

    const row = await env.DB.prepare("SELECT id FROM workspaces WHERE id = ?").bind(id).first();
    expect(row).toEqual({ id });
  });

  it("keeps an existing workspace without re-setting the cookie", async () => {
    const first = await exports.default.fetch(`${BASE}/api/session`);
    const id = wsCookie(first)!.split(";")[0]!.split("=")[1]!;
    const { demoUrl } = await first.json<{ demoUrl: string }>();

    const again = await exports.default.fetch(`${BASE}/api/session`, { headers: { cookie: `__Host-ws=${id}` } });
    expect(wsCookie(again)).toBeUndefined();
    expect((await again.json<{ demoUrl: string }>()).demoUrl).toBe(demoUrl);
  });

  it("replaces a malformed cookie", async () => {
    const res = await exports.default.fetch(`${BASE}/api/session`, { headers: { cookie: "__Host-ws=not-an-id" } });
    expect(wsCookie(res)).toMatch(/^__Host-ws=[0-9a-f]{32};/);
  });

  it("ignores a cookie without the __Host- prefix", async () => {
    const res = await exports.default.fetch(`${BASE}/api/session`, {
      headers: { cookie: "ws=0123456789abcdef0123456789abcdef" },
    });
    expect(wsCookie(res)).toBeDefined();
  });
});
