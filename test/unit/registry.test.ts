import { describe, expect, it } from "vitest";
import { evidenceId, llmTools, runTool } from "../../worker/tools/registry";
import { byHost, dohHandler, fakeFetch } from "./helpers/fake-fetch";

const scope = { host: "shop.example.com", cnameTargets: ["shop.example.com.cdn.cloudflare.net"] };
const zone = { "shop.example.com": { A: ["93.184.215.14"] } };
const ctx = () => ({
  fetch: fakeFetch(byHost({ "cloudflare-dns.com": dohHandler(zone), "dns.google": dohHandler(zone), "shop.example.com": () => new Response("ok") })),
  evidenceId: "x-1",
});

describe("registry", () => {
  it("builds evidence IDs", () => {
    expect(evidenceId("dns_lookup", 1)).toBe("dns-1");
    expect(evidenceId("http_probe", 12)).toBe("http-12");
    expect(evidenceId("provider_status", 2)).toBe("status-2");
  });

  it("exposes OpenAI-style tool definitions with optional defaults", () => {
    const tools = llmTools();
    expect(tools.map((t) => t.function.name)).toEqual(["dns_lookup", "http_probe"]);
    const dns = tools[0]!.function.parameters as { required: string[]; properties: Record<string, unknown> };
    expect(dns.required).toEqual(["hostname"]);
    expect(dns.properties).toHaveProperty("types");
    expect(tools[0]!.function.parameters).not.toHaveProperty("$schema");
  });

  it("runs a valid, in-scope call and counts subrequests", async () => {
    const out = await runTool("dns_lookup", { hostname: "shop.example.com", types: ["A"] }, ctx(), scope);
    expect(out).toMatchObject({ ok: true, subrequests: 2, cap: 2, result: { status: "pass" } });
  });

  it.each([
    ["dns_lookup", { hostname: 42 }, /Invalid arguments/],
    ["dns_lookup", { hostname: "10.0.0.1" }, /Invalid arguments/],
    ["http_probe", { url: "ftp://shop.example.com/" }, /Invalid arguments/],
    ["http_probe", { url: "https://other.example.com/" }, /limited to shop\.example\.com/],
    ["dns_lookup", { hostname: "attacker.example.net" }, /isn't one/],
    ["rm_rf", {}, /Unknown tool/],
  ])("reports %s %j as invalid", async (name, args, message) => {
    const out = await runTool(name, args, ctx(), scope);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.invalid).toMatch(message);
  });

  it("enforces the per-tool cap", async () => {
    const out = await runTool("http_probe", { url: "https://shop.example.com/" }, ctx(), scope);
    expect(out.ok && out.subrequests).toBeLessThanOrEqual(out.ok ? out.cap : 0);
  });
});
