import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const BASE = "https://copilot.example.com";

/** A fresh workspace: its cookie header for later requests. */
async function workspace(): Promise<string> {
  const res = await exports.default.fetch(`${BASE}/api/session`);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("__Host-ws="))!;
  return cookie.split(";")[0]!;
}

const post = (path: string, cookie: string, body?: unknown) =>
  exports.default.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Cookie: cookie, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const get = (path: string, cookie: string) => exports.default.fetch(`${BASE}${path}`, { headers: { Cookie: cookie } });

describe("/api/incidents", () => {
  it("asks for a target when the message names none", async () => {
    const res = await post("/api/incidents", await workspace(), { message: "everything is broken" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "need_target" });
    expect((await post("/api/incidents", await workspace(), {})).status).toBe(400);
  });

  it("creates an incident for the demo and lists it for its workspace only", async () => {
    const mine = await workspace();
    const res = await post("/api/incidents", mine, { message: "what's wrong with my demo?" });
    expect(res.status).toBe(200);
    const { id } = await res.json<{ id: string }>();
    expect(id).toMatch(/^[0-9a-f]{32}$/);

    const list = await (await get("/api/incidents", mine)).json<{ id: string; status: string; target: string; unread: boolean }[]>();
    expect(list).toEqual([expect.objectContaining({ id, status: "investigating", origin: "chat", unread: false })]);
    expect(list[0]!.target).toMatch(/\/w\/[0-9a-f]{32}\/$/);
    expect(await (await get("/api/incidents", await workspace())).json()).toEqual([]);
  });

  it("serves the snapshot to the owner only", async () => {
    const mine = await workspace();
    const { id } = await (await post("/api/incidents", mine, { message: "diagnose shop.example.com" })).json<{ id: string }>();

    const snap = await get(`/api/incidents/${id}`, mine);
    expect(snap.status).toBe(200);
    expect(await snap.json()).toMatchObject({ id, target: "https://shop.example.com/", activeRunId: "run-1" });

    expect((await get(`/api/incidents/${id}`, await workspace())).status).toBe(404);
    expect((await get("/api/incidents/not-an-id", mine)).status).toBe(404);
  });

  it("marks an incident read", async () => {
    const mine = await workspace();
    const { id } = await (await post("/api/incidents", mine, { message: "diagnose shop.example.com" })).json<{ id: string }>();
    expect((await post(`/api/incidents/${id}/read`, mine)).status).toBe(204);
    expect((await post(`/api/incidents/${id}/read`, await workspace())).status).toBe(404);
  });
});
