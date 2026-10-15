import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { incidentAgent } from "../../worker/agent/stub";
import { newId } from "../../worker/lib/ids";
import { takeRun, takeWindow } from "../../worker/safety/quota";

const BASE = "https://copilot.example.com";
const HOUR = 3_600_000;

async function workspace(): Promise<string> {
  const res = await exports.default.fetch(`${BASE}/api/session`);
  return res.headers.getSetCookie().find((c) => c.startsWith("__Host-ws="))!.split(";")[0]!;
}

const create = (cookie: string, message = "diagnose shop.example.com") =>
  exports.default.fetch(`${BASE}/api/incidents`, {
    method: "POST",
    headers: { Cookie: cookie, "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });

/** The message of a rejected RPC call (awaiting the RPC promise directly, as in agent.test.ts). */
async function errorOf(p: PromiseLike<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected the call to fail");
}

const allowAll = { limit: async () => ({ success: true }) } as unknown as RateLimit;
const broken = { limit: async () => Promise.reject(new Error("binding down")) } as unknown as RateLimit;

describe("run quota (D14)", () => {
  it("refuses the 4th new incident in a minute with the time until reset; other workspaces are unaffected", async () => {
    const mine = await workspace();
    for (let i = 0; i < 3; i++) expect((await create(mine)).status).toBe(200);

    const res = await create(mine);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(await res.json()).toEqual({ error: "rate_limited", retryAfter: 60 });

    expect((await create(await workspace())).status).toBe(200);
  });

  it("doesn't charge a message that can't become an incident", async () => {
    const mine = await workspace();
    for (let i = 0; i < 4; i++) expect((await create(mine, "everything is broken")).status).toBe(400);
    expect((await create(mine)).status).toBe(200);
  });

  it("allows 10 runs an hour, then counts down to the end of the window", async () => {
    const ws = newId();
    const start = Date.UTC(2030, 0, 1, 10, 0, 0);
    for (let i = 0; i < 10; i++) expect(await takeRun({ RUN_LIMIT: allowAll, DB: env.DB }, ws, start + i * 1000)).toEqual({ ok: true });
    expect(await takeRun({ RUN_LIMIT: allowAll, DB: env.DB }, ws, start + 20 * 60_000)).toEqual({ ok: false, retryAfter: 40 * 60 });
    expect(await takeRun({ RUN_LIMIT: allowAll, DB: env.DB }, ws, start + HOUR)).toEqual({ ok: true });
  });

  it("keeps windows per workspace and kind", async () => {
    const [a, b] = [newId(), newId()];
    const now = Date.UTC(2030, 0, 2);
    expect(await takeWindow(env.DB, a, "voice", 1, HOUR, now)).toEqual({ ok: true });
    expect(await takeWindow(env.DB, a, "voice", 1, HOUR, now)).toMatchObject({ ok: false });
    expect(await takeWindow(env.DB, a, "run", 1, HOUR, now)).toEqual({ ok: true });
    expect(await takeWindow(env.DB, b, "voice", 1, HOUR, now)).toEqual({ ok: true });
  });

  it("fails open when the binding or D1 errors", async () => {
    const db = { prepare: () => { throw new Error("D1 down"); } } as unknown as D1Database;
    expect(await takeRun({ RUN_LIMIT: broken, DB: db }, newId())).toEqual({ ok: true });
  });

  it("counts follow-ups; a follow-up while a run is active isn't charged", async () => {
    const ws = newId();
    const agent = await incidentAgent(env, newId());
    const { runId } = await agent.init({ workspaceId: ws, target: "https://shop.example.com/", origin: "chat", message: "why?" });

    expect(await errorOf(agent.sendMessage("and now?"))).toBe("run_active");
    const counted = await env.DB.prepare("SELECT COUNT(*) AS n FROM usage_counters WHERE workspace_id = ?").bind(ws).first<{ n: number }>();
    expect(counted?.n).toBe(0);

    await agent.finishRun(runId!, "done");
    for (let i = 0; i < 3; i++) expect((await takeRun(env, ws)).ok).toBe(true);
    expect(await errorOf(agent.sendMessage("and now?"))).toBe("rate_limited:60");
  });
});
