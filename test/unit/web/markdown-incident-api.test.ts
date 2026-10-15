import { describe, expect, it } from "vitest";
import { createIncident, listIncidents } from "../../../web/lib/api";
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
    expect(await createIncident("x", fake(429, { retryAfter: 30 }))).toEqual({ ok: false, error: "rate_limited" });
    expect(await createIncident("x", fake(500, { error: "boom" }))).toEqual({ ok: false, error: "server" });
    const offline = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await createIncident("x", offline)).toEqual({ ok: false, error: "network" });
    expect(await listIncidents(offline)).toEqual([]);
  });
});
