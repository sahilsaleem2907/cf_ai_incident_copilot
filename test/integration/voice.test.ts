import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { VOICE_MAX_BYTES } from "../../worker/api/voice";
import { newId } from "../../worker/lib/ids";
import { BUDGET_GUARD_AT } from "../../worker/loop/budget";

const BASE = "https://copilot.example.com";
const today = () => new Date().toISOString().slice(0, 10);
const post = (ws: string, body: BodyInit | null, type = "audio/webm", headers: Record<string, string> = {}) =>
  exports.default.fetch(`${BASE}/api/voice`, { method: "POST", headers: { cookie: `__Host-ws=${ws}`, "content-type": type, ...headers }, body });
const audio = (n = 2000) => new Uint8Array(n).fill(7);

describe("POST /api/voice (WP-23)", () => {
  afterEach(async () => {
    await env.DB.prepare("DELETE FROM llm_usage WHERE day = ?").bind(today()).run();
  });

  it("returns the normalised transcript (mock Whisper) and counts it in the hourly window", async () => {
    const ws = newId();
    const res = await post(ws, audio());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "is demo.example.com down" });
    const row = await env.DB.prepare("SELECT SUM(count) AS n FROM usage_counters WHERE workspace_id = ? AND kind = 'voice'").bind(ws).first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it("refuses anything that isn't audio", async () => {
    const res = await post(newId(), "hello", "text/plain");
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "unsupported_type" });
  });

  it("refuses a recording over the size cap, by header and by the real body", async () => {
    const big = await post(newId(), audio(VOICE_MAX_BYTES + 1));
    expect(big.status).toBe(413);
    expect(await big.json()).toEqual({ error: "too_large" });
    const lying = await post(newId(), audio(10), "audio/webm", { "content-length": String(VOICE_MAX_BYTES * 2) });
    expect(lying.status).toBe(413);
  });

  it("refuses an empty recording", async () => {
    const res = await post(newId(), new Uint8Array());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "empty_audio" });
  });

  it("6th in a minute → 429 with Retry-After, and other workspaces aren't affected", async () => {
    const ws = newId();
    for (let i = 0; i < 5; i++) expect((await post(ws, audio())).status).toBe(200);
    const res = await post(ws, audio());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited", retryAfter: 60 });
    expect(res.headers.get("Retry-After")).toBe("60");
    expect((await post(newId(), audio())).status).toBe(200);
  });

  it("is off when the budget guard is on, before any quota is used", async () => {
    await env.DB.prepare("INSERT INTO llm_usage (day, neurons_est) VALUES (?1, ?2)").bind(today(), BUDGET_GUARD_AT).run();
    const ws = newId();
    const res = await post(ws, audio());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "voice_unavailable" });
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM usage_counters WHERE workspace_id = ? AND kind = 'voice'").bind(ws).first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});
