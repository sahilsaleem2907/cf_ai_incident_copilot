import { describe, expect, it } from "vitest";
import { DIGEST_MAX } from "../../worker/tools/digest";
import { dnsInput, runDnsLookup } from "../../worker/tools/dns";
import { byHost, dohHandler, fakeFetch, type Records } from "./helpers/fake-fetch";

function run(cf: Record<string, Records>, google: Record<string, Records>, hostname = "shop.example.com", types?: string[]) {
  const f = fakeFetch(byHost({ "cloudflare-dns.com": dohHandler(cf), "dns.google": dohHandler(google) }));
  const input = dnsInput.parse({ hostname, ...(types ? { types } : {}) });
  return { f, result: runDnsLookup(input, { fetch: f, evidenceId: "dns-1" }) };
}

const same = (r: Records) => ({ "shop.example.com": r });

describe("dns_lookup", () => {
  it("passes when both resolvers agree", async () => {
    const zone = same({ A: ["93.184.215.14"], AAAA: ["2606:2800:21f:cb07::1"] });
    const { f, result } = run(zone, zone);
    const r = await result;
    expect(r).toMatchObject({ evidenceId: "dns-1", tool: "dns_lookup", ok: true, status: "pass" });
    expect(r.raw).toMatchObject({ mismatch: false, addressesDiffer: false, ssrfBlocked: false });
    expect(r.summary).toContain("93.184.215.14");
    expect(r.summary).toContain("both resolvers agree");
    expect(f.calls).toHaveLength(4); // 2 resolvers × 2 types
  });

  it("fails on NXDOMAIN", async () => {
    const r = await run({}, {}).result;
    expect(r).toMatchObject({ ok: true, status: "fail" });
    expect(r.summary).toContain("NXDOMAIN");
    expect(r.raw.mismatch).toBe(false);
  });

  it("fails on SERVFAIL", async () => {
    const zone = same({ status: 2 });
    expect(await run(zone, zone).result).toMatchObject({ status: "fail", summary: expect.stringContaining("SERVFAIL") });
  });

  it("flags a real disagreement: one resolver has the name, the other doesn't", async () => {
    const r = await run(same({ A: ["93.184.215.14"] }), {}).result;
    expect(r.raw.mismatch).toBe(true);
    expect(r.status).toBe("fail");
    expect(r.summary).toMatch(/disagree.*cloudflare NOERROR.*google NXDOMAIN/);
  });

  it("treats different address lists as normal (geo/CDN DNS)", async () => {
    const r = await run(same({ A: ["142.250.1.1"] }), same({ A: ["142.250.2.2"] })).result;
    expect(r.raw).toMatchObject({ mismatch: false, addressesDiffer: true });
    expect(r.status).toBe("pass");
    expect(r.summary).toContain("normal for CDNs");
  });

  it("records the CNAME chain as targets for the origin pin", async () => {
    const zone = same({ CNAME: ["shop.example.com.cdn.cloudflare.net."], A: ["104.16.1.1"] });
    const r = await run(zone, zone).result;
    expect(r.raw.cnameTargets).toEqual(["shop.example.com.cdn.cloudflare.net"]);
    expect(r.summary).toContain("via shop.example.com.cdn.cloudflare.net");
  });

  it("flags private answers", async () => {
    const zone = same({ A: ["10.1.2.3"] });
    const r = await run(zone, zone).result;
    expect(r.raw.ssrfBlocked).toBe(true);
    expect(r.summary).toContain("private address");
  });

  it("is unavailable when both resolvers are down", async () => {
    const f = fakeFetch(() => new Response("down", { status: 503 }));
    const r = await runDnsLookup(dnsInput.parse({ hostname: "shop.example.com" }), { fetch: f, evidenceId: "dns-2" });
    expect(r).toMatchObject({ ok: false, status: "unavailable" });
  });

  it("does not call a resolver outage a mismatch", async () => {
    const f = fakeFetch(
      byHost({
        "cloudflare-dns.com": dohHandler(same({ A: ["93.184.215.14"] })),
        "dns.google": () => new Response("down", { status: 503 }),
      }),
    );
    const r = await runDnsLookup(dnsInput.parse({ hostname: "shop.example.com" }), { fetch: f, evidenceId: "dns-3" });
    expect(r.raw.mismatch).toBe(false);
    expect(r.status).toBe("pass");
  });

  it("queries 2 × types and normalises the hostname", async () => {
    const zone = same({ A: ["1.2.3.4"], MX: ["10 mail.example.com."] });
    const { f, result } = run(zone, zone, "SHOP.Example.com.", ["A", "MX", "CNAME"]);
    const r = await result;
    expect(f.calls).toHaveLength(6);
    expect(r.raw.hostname).toBe("shop.example.com");
  });

  it("keeps the digest under 1.5 KB even with many answers", async () => {
    const many = Array.from({ length: 60 }, (_, i) => `2606:4700:${i.toString(16)}::1`);
    const zone = same({ A: Array.from({ length: 60 }, (_, i) => `104.16.${i}.1`), AAAA: many });
    const r = await run(zone, zone).result;
    expect(new TextEncoder().encode(r.digest).length).toBeLessThanOrEqual(DIGEST_MAX);
    expect(JSON.parse(r.digest)).toHaveProperty("host", "shop.example.com");
  });

  it.each(["10.0.0.1", "https://example.com", "localhost", "", "exa mple.com"])("rejects hostname %j", (hostname) => {
    expect(dnsInput.safeParse({ hostname }).success).toBe(false);
  });
});
