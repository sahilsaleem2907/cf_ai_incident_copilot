import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const BASE = "https://copilot.example.com";

/** The inline demo stub (vitest.config.ts) also records every setMode. */
const demoStub = env.DEMO as unknown as { calls(ws: string): Promise<{ ws: string; modes: string[] }[]> };

async function workspace(): Promise<{ cookie: string; ws: string }> {
  const res = await exports.default.fetch(`${BASE}/api/session`);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("__Host-ws="))!.split(";")[0]!;
  return { cookie, ws: cookie.split("=")[1]! };
}

const setMode = (cookie: string, body: unknown) =>
  exports.default.fetch(`${BASE}/api/demo/mode`, {
    method: "POST",
    headers: { Cookie: cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const getDemo = (cookie: string) => exports.default.fetch(`${BASE}/api/demo`, { headers: { Cookie: cookie } });

describe("/api/demo", () => {
  it("returns the workspace's mode and demo URL", async () => {
    const { cookie, ws } = await workspace();
    const res = await getDemo(cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ modes: ["healthy"], url: `${env.DEMO_BASE_URL}/w/${ws}/` });
  });

  it("sets the mode through the DEMO binding, for the caller's workspace only", async () => {
    const mine = await workspace();
    const other = await workspace();
    const res = await setMode(mine.cookie, { modes: ["errors", "slow"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ modes: ["slow", "errors"], url: `${env.DEMO_BASE_URL}/w/${mine.ws}/` });
    expect(await demoStub.calls(mine.ws)).toEqual([{ ws: mine.ws, modes: ["slow", "errors"] }]);
    expect(await (await getDemo(mine.cookie)).json()).toMatchObject({ modes: ["slow", "errors"] });
    expect(await (await getDemo(other.cookie)).json()).toMatchObject({ modes: ["healthy"] });
  });

  it("rejects unknown, missing or clashing modes without calling the demo", async () => {
    const { cookie, ws } = await workspace();
    for (const body of [{ modes: ["on_fire"] }, {}, { modes: "errors" }, { modes: [] }, { modes: ["healthy", "errors"] }, { modes: ["errors", "redirect_loop"] }]) {
      const res = await setMode(cookie, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_modes" });
    }
    expect(await demoStub.calls(ws)).toEqual([]);
  });
});

describe("/w/* on the main Worker", () => {
  it("passes through to the demo only when DEMO_BASE_URL is this Worker's origin (local dev)", async () => {
    const path = "/w/0123456789abcdef0123456789abcdef/";
    const local = await exports.default.fetch(`${env.DEMO_BASE_URL}${path}`);
    expect(await local.text()).toBe(`demo stub ${path}`);
    expect((await exports.default.fetch(`${BASE}${path}`)).status).toBe(404);
  });
});
