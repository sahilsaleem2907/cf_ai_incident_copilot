import { describe, expect, it } from "vitest";
import { createIncident, getDemo, listIncidents, parseRateLimited, retryText, sessionOnce, setDemoModes } from "../../../web/lib/api";
import { otherHost, runNote } from "../../../web/lib/incident";
import { parseInline, parseMarkdown } from "../../../web/lib/markdown";
import type { TimelineView } from "../../../worker/agent/state";

const known = new Set(["http-1", "dns-1"]);

describe("parseMarkdown", () => {
  it("handles the narration format", () => {
    const md = "**Likely cause:** The origin returns HTTP 500 [http-1].\n\n**Evidence**\n- HTTP probe: 500/500/500 [http-1]\n- DNS lookup: ok [dns-1]\n\n_1 uncited statement removed_";
    expect(parseMarkdown(md, known)).toEqual([
      { t: "p", c: [{ t: "bold", c: [{ t: "text", v: "Likely cause:" }] }, { t: "text", v: " The origin returns HTTP 500 " }, { t: "ref", id: "http-1" }, { t: "text", v: "." }] },
      { t: "p", c: [{ t: "bold", c: [{ t: "text", v: "Evidence" }] }] },
      {
        t: "ul",
        items: [
          [{ t: "text", v: "HTTP probe: 500/500/500 " }, { t: "ref", id: "http-1" }],
          [{ t: "text", v: "DNS lookup: ok " }, { t: "ref", id: "dns-1" }],
        ],
      },
      { t: "p", c: [{ t: "italic", c: [{ t: "text", v: "1 uncited statement removed" }] }] },
    ]);
  });

  it("keeps line breaks inside a paragraph", () => {
    expect(parseMarkdown("**Likely cause:**\nThe origin fails.", known)[0]).toEqual({
      t: "p",
      c: [{ t: "bold", c: [{ t: "text", v: "Likely cause:" }] }, { t: "br" }, { t: "text", v: "The origin fails." }],
    });
  });

  it("leaves unknown refs, snake_case and HTML as plain text", () => {
    expect(parseInline("see [cert-9] and set_cookie_value <img src=x onerror=alert(1)>", known)).toEqual([
      { t: "text", v: "see " },
      { t: "text", v: "[cert-9]" },
      { t: "text", v: " and set_cookie_value <img src=x onerror=alert(1)>" },
    ]);
  });

  it("parses code and refs inside bold", () => {
    expect(parseInline("`cache-control` **slow [http-1]**", known)).toEqual([
      { t: "code", v: "cache-control" },
      { t: "text", v: " " },
      { t: "bold", c: [{ t: "text", v: "slow " }, { t: "ref", id: "http-1" }] },
    ]);
  });
});

describe("otherHost", () => {
  it("spots a follow-up about a different host", () => {
    expect(otherHost("what about api.example.com?", "shop.example.com")).toBe("api.example.com");
    expect(otherHost("check https://www.cloudflare.com/x", "cloudflare.com")).toBe("www.cloudflare.com");
  });
  it("ignores the same host, no host, and 'demo'", () => {
    expect(otherHost("is shop.example.com still down?", "shop.example.com")).toBeNull();
    expect(otherHost("is it still down?", "shop.example.com")).toBeNull();
    expect(otherHost("try the demo again", "shop.example.com")).toBeNull();
  });
});

describe("runNote", () => {
  const ev = (id: number, type: string, status?: string): TimelineView => ({ id, ts: id, type, detail: status ? { runId: "run-1", status } : { runId: "run-1" } });
  it("names the limit that ended the latest run", () => {
    expect(runNote([ev(1, "run_started"), ev(2, "run_finished", "limit_tools")])).toBe("Stopped at the 6-check limit. The diagnosis uses the checks it completed.");
    expect(runNote([ev(1, "run_started"), ev(2, "run_finished", "limit_deadline")])).toMatch(/^Stopped at the 60-second limit/);
    expect(runNote([ev(1, "run_finished", "failed")])).toMatch(/failed/);
  });
  it("says nothing for a normal finish, LLM-unavailable (its own banner) or a newer run in progress", () => {
    expect(runNote([ev(1, "run_finished", "done")])).toBeNull();
    expect(runNote([ev(1, "run_finished", "llm_unavailable")])).toBeNull();
    expect(runNote([ev(1, "run_finished", "limit_tools"), ev(2, "run_started")])).toBeNull();
    expect(runNote([])).toBeNull();
  });
});

describe("api", () => {
  const fake = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it("maps responses to results and errors", async () => {
    expect(await createIncident("x", fake(200, { id: "abc" }))).toEqual({ ok: true, id: "abc" });
    expect(await createIncident("x", fake(400, { error: "need_target" }))).toEqual({ ok: false, error: "need_target" });
    expect(await createIncident("x", fake(503, { error: "demo_unavailable" }))).toEqual({ ok: false, error: "demo_unavailable" });
    expect(await createIncident("x", fake(429, { error: "rate_limited", retryAfter: 1800 }))).toEqual({ ok: false, error: "rate_limited", retryAfter: 1800 });
    expect(await createIncident("x", fake(500, { error: "boom" }))).toEqual({ ok: false, error: "server" });
    const offline = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await createIncident("x", offline)).toEqual({ ok: false, error: "network" });
    expect(await listIncidents(offline)).toEqual([]);
  });

  it("reads the time until reset from a 429 body, else the Retry-After header, else a minute", async () => {
    const res = (status: number, body: string, headers: Record<string, string> = {}) => (async () => new Response(body, { status, headers })) as unknown as typeof fetch;
    expect(await createIncident("x", res(429, "{}", { "Retry-After": "120" }))).toEqual({ ok: false, error: "rate_limited", retryAfter: 120 });
    expect(await createIncident("x", res(429, "not json"))).toEqual({ ok: false, error: "rate_limited", retryAfter: 60 });
  });

  it("makes the first-visit session call once, however often it's asked (StrictMode runs effects twice)", async () => {
    let calls = 0;
    const f = (async () => {
      calls++;
      return new Response(JSON.stringify({ demoUrl: "u", budgetMode: "ai" }));
    }) as unknown as typeof fetch;
    const first = sessionOnce(f);
    const [a, b] = await Promise.all([first(), first()]);
    expect(await first()).toEqual({ demoUrl: "u", budgetMode: "ai" });
    expect(a).toBe(b);
    expect(calls).toBe(1);
  });

  it("parses the agent's rate_limited error and words the wait", () => {
    expect(parseRateLimited("rate_limited:60")).toBe(60);
    expect(parseRateLimited("Error: rate_limited:2400")).toBe(2400);
    expect(parseRateLimited("run_active")).toBeNull();
    expect([retryText(60), retryText(90), retryText(91), retryText(2400)]).toEqual(["about a minute", "about a minute", "2 minutes", "40 minutes"]);
  });

  it("reads and sets the demo modes", async () => {
    const demo = { modes: ["slow", "errors"], url: "http://localhost:5173/w/x/" };
    let sent: RequestInit | undefined;
    const capture = (async (_: string, init?: RequestInit) => {
      sent = init;
      return new Response(JSON.stringify(demo));
    }) as unknown as typeof fetch;
    expect(await setDemoModes(["slow", "errors"], capture)).toEqual({ ok: true, demo });
    expect(sent).toMatchObject({ method: "POST", body: '{"modes":["slow","errors"]}' });
    expect(await getDemo(fake(200, demo))).toEqual({ ok: true, demo });
    expect(await getDemo(fake(503, { error: "demo_unavailable" }))).toEqual({ ok: false, error: "demo_unavailable" });
    expect(await setDemoModes(["slow"], fake(400, { error: "invalid_modes" }))).toEqual({ ok: false, error: "server" });
    const offline = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await getDemo(offline)).toEqual({ ok: false, error: "network" });
  });
});
