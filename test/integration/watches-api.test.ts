import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { newId } from "../../worker/lib/ids";
import { clearWatches, seedWatch } from "./helpers/watches";

const BASE = "https://copilot.example.com";

async function workspace(): Promise<{ cookie: string; ws: string }> {
  const res = await exports.default.fetch(`${BASE}/api/session`);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("__Host-ws="))!.split(";")[0]!;
  return { cookie, ws: cookie.split("=")[1]! };
}

const add = (cookie: string, url: string, intervalSec?: number) =>
  exports.default.fetch(`${BASE}/api/watches`, {
    method: "POST",
    headers: { Cookie: cookie, "content-type": "application/json" },
    body: JSON.stringify({ url, ...(intervalSec ? { intervalSec } : {}) }),
  });
const list = async (cookie: string) => (await exports.default.fetch(`${BASE}/api/watches`, { headers: { Cookie: cookie } })).json<{ id: string; url: string; intervalSec: number }[]>();
const del = (cookie: string, id: string) => exports.default.fetch(`${BASE}/api/watches/${id}`, { method: "DELETE", headers: { Cookie: cookie } });

describe("/api/watches (FR-40)", () => {
  it("adds a URL or hostname, checked from the next cron tick, expiring in 24 h", async () => {
    const { cookie } = await workspace();
    const before = Date.now();
    const res = await add(cookie, "shop.example.com");
    expect(res.status).toBe(201);
    const w = await res.json<{ url: string; intervalSec: number; nextRun: number; expiresAt: number; lastStatus: null }>();
    expect(w).toMatchObject({ url: "https://shop.example.com/", intervalSec: 300, lastStatus: null });
    expect(w.nextRun).toBeGreaterThanOrEqual(before);
    expect(w.expiresAt - w.nextRun).toBe(24 * 3_600_000);
    expect((await list(cookie)).map((x) => x.url)).toEqual(["https://shop.example.com/"]);
  });

  it("checks our own demo every minute; real sites every 5 to 60 minutes", async () => {
    const { cookie, ws } = await workspace();
    expect(await (await add(cookie, "watch my demo")).json()).toMatchObject({ url: `${env.DEMO_BASE_URL}/w/${ws}/`, intervalSec: 60 });
    expect(await (await add(cookie, "https://a.example.com/", 60)).json()).toMatchObject({ intervalSec: 300 });
    expect(await (await add(cookie, "https://b.example.com/", 99_999)).json()).toMatchObject({ intervalSec: 3600 });
  });

  it("refuses what isn't a public URL", async () => {
    const { cookie } = await workspace();
    for (const bad of ["", "nothing here", "http://169.254.169.254/", "http://localhost/", "https://shop.example.com:8443/"]) {
      const res = await add(cookie, bad);
      expect(res.status, bad).toBe(400);
      expect(await res.json(), bad).toMatchObject({ error: "invalid_url", message: expect.any(String) });
    }
  });

  it("allows 3 watches per workspace, one per URL", async () => {
    const { cookie } = await workspace();
    for (const h of ["a", "b", "c"]) expect((await add(cookie, `https://${h}.example.com/`)).status).toBe(201);
    expect(await (await add(cookie, "https://a.example.com/")).json()).toEqual({ error: "already_watched" });
    const res = await add(cookie, "https://d.example.com/");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "watch_limit" });
  });

  it("allows 30 watches across the app", async () => {
    await clearWatches();
    for (let i = 0; i < 30; i++) await seedWatch({ url: `https://s${i}.example.com/` });
    const res = await add((await workspace()).cookie, "https://one-more.example.com/");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "watch_capacity" });
    await clearWatches();
  });

  it("deletes only the caller's own watches", async () => {
    const mine = await workspace();
    const { id } = await (await add(mine.cookie, "https://mine.example.com/")).json<{ id: string }>();
    expect((await del((await workspace()).cookie, id)).status).toBe(404);
    expect((await del(mine.cookie, newId())).status).toBe(404);
    expect((await del(mine.cookie, id)).status).toBe(204);
    expect(await list(mine.cookie)).toEqual([]);
  });
});
