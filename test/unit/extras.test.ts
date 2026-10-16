import { describe, expect, it } from "vitest";
import { extraCalls, httpSignals } from "../../worker/loop/extras";
import type { HttpRaw, Sample } from "../../worker/tools/http";
import type { ToolName } from "../../worker/tools/types";

const sample = (o: Partial<Sample>): Sample => ({ status: 200, ttfbMs: 10, totalMs: 20, stop: "done", hops: [], ...o });
const raw = (samples: Sample[], headers: HttpRaw["headers"] = { setCookie: false }, url = "https://shop.example.com/"): HttpRaw => ({
  url,
  method: "GET",
  samples,
  medianTotalMs: 20,
  medianTtfbMs: 10,
  hops: [],
  headers,
  snippet: null,
  asset: null,
});
const refused = sample({ status: null, ttfbMs: null, stop: "error", error: "network", message: "internal error; reference = x" });
const none = new Set<ToolName>();
const calls = (r: HttpRaw, o: { cnames?: string[]; ran?: Set<ToolName>; isDemo?: boolean } = {}) =>
  extraCalls({ host: "shop.example.com", signals: httpSignals(r), cnames: o.cnames ?? [], ran: o.ran ?? none, isDemo: o.isDemo ?? false });

describe("automatic cert/provider checks (WP-21, only when useful)", () => {
  it("a healthy site gets none", () => {
    expect(calls(raw([sample({}), sample({})], { setCookie: false, server: "cloudflare" }))).toEqual([]);
  });

  it("HTTPS that fails to connect gets cert_info", () => {
    expect(calls(raw([refused, refused]))).toEqual([{ tool: "cert_info", args: { hostname: "shop.example.com" } }]);
  });

  it("plain HTTP or a timeout doesn't get cert_info", () => {
    expect(calls(raw([refused], { setCookie: false }, "http://shop.example.com/"))).toEqual([]);
    expect(calls(raw([sample({ status: null, stop: "error", error: "timeout" })]))).toEqual([]);
  });

  it("a failing site behind a known provider gets provider_status for that provider", () => {
    expect(calls(raw([sample({ status: 503 })], { setCookie: false, "cf-ray": "abc-LHR" }))).toEqual([{ tool: "provider_status", args: { providers: ["cloudflare"] } }]);
    expect(calls(raw([sample({ status: 500 })]), { cnames: ["user.github.io", "x.s3.amazonaws.com"] })).toEqual([{ tool: "provider_status", args: { providers: ["github", "aws"] } }]);
  });

  it("an unknown host's 500s don't get provider_status", () => {
    expect(calls(raw([sample({ status: 500 })], { setCookie: false, server: "nginx" }))).toEqual([]);
  });

  it("the user's own demo never gets provider_status (its 500s are ours, not Cloudflare's)", () => {
    expect(calls(raw([sample({ status: 500 })], { setCookie: false, server: "cloudflare" }), { isDemo: true })).toEqual([]);
  });

  it("skips what already ran this run, and needs an http_probe", () => {
    expect(calls(raw([refused], { setCookie: false, server: "cloudflare" }), { ran: new Set(["cert_info", "provider_status"]) })).toEqual([]);
    expect(extraCalls({ host: "shop.example.com", signals: null, cnames: [], ran: none, isDemo: false })).toEqual([]);
  });
});
