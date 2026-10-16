import { describe, expect, it } from "vitest";
import { certQueries, crtUrl, parseCrt, runCertInfo, sanMatches } from "../../worker/tools/cert";
import { byHost, fakeFetch, type Handler } from "./helpers/fake-fetch";

const NOW = Date.parse("2026-10-16T12:00:00Z");
const entry = (o: { name: string; notAfter: string; serial?: string; issuer?: string }) => ({
  id: Math.floor(Math.random() * 1e9),
  serial_number: o.serial ?? o.name + o.notAfter,
  issuer_name: o.issuer ?? "C=US, O=Let's Encrypt, CN=YE2",
  common_name: o.name.split("\n")[0],
  name_value: o.name,
  not_before: "2026-09-25T10:09:59",
  not_after: o.notAfter,
});

/** crt.sh answering per query (`q`), like the real service. */
function crt(byQuery: Record<string, unknown[] | Response>): Handler {
  return (url) => {
    const q = url.searchParams.get("q") ?? "";
    const r = byQuery[q];
    if (r instanceof Response) return r;
    return Response.json(r ?? []);
  };
}

const run = (hostname: string, handler: Handler, extra: Record<string, unknown> = {}) => {
  const fetch = fakeFetch(byHost({ "crt.sh": handler }));
  return { fetch, result: runCertInfo({ hostname }, { fetch, evidenceId: "cert-1", now: () => NOW, cache: null, ...extra }) };
};

describe("cert_info helpers", () => {
  it("asks for the host and for wildcard certificates one label up, but never *.tld", () => {
    expect(certQueries("shop.example.com")).toEqual(["shop.example.com", "*.example.com"]);
    expect(certQueries("example.com")).toEqual(["example.com"]);
    expect(crtUrl("*.example.com")).toBe("https://crt.sh/?q=*.example.com&output=json&exclude=expired&deduplicate=Y");
  });

  it("matches SANs exactly or as a one-label wildcard", () => {
    expect(sanMatches("shop.example.com", "shop.example.com")).toBe(true);
    expect(sanMatches("shop.example.com", "*.example.com")).toBe(true);
    expect(sanMatches("a.shop.example.com", "*.example.com")).toBe(false);
    expect(sanMatches("example.com", "*.example.com")).toBe(false);
    expect(sanMatches("shop.example.com", "SHOP.EXAMPLE.COM.")).toBe(true);
  });

  it("parses a body cut off by the read cap up to its last complete entry", () => {
    const body = JSON.stringify([entry({ name: "a.example.com", notAfter: "2026-12-01T00:00:00" }), entry({ name: "b.example.com", notAfter: "2026-12-01T00:00:00" })]);
    const cut = body.slice(0, body.length - 30);
    expect(parseCrt(cut, true)).toHaveLength(1);
    expect(parseCrt(cut, false)).toBeNull();
    expect(parseCrt("<html>busy</html>", false)).toBeNull();
    expect(parseCrt('{"not":"an array"}', false)).toBeNull();
  });

  it("reads at most 20 entries", () => {
    const many = Array.from({ length: 50 }, (_, i) => entry({ name: `h${i}.example.com`, notAfter: "2026-12-01T00:00:00" }));
    expect(parseCrt(JSON.stringify(many), false)).toHaveLength(20);
  });
});

describe("cert_info", () => {
  it("finds a wildcard certificate through the *.parent query (WP-21 spike: exact queries miss them)", async () => {
    const { fetch, result } = run(
      "demo.sahil.workers.dev",
      crt({ "*.sahil.workers.dev": [entry({ name: "*.sahil.workers.dev", notAfter: "2026-12-24T12:35:14", issuer: "C=US, O=SSL Corporation, CN=Cloudflare TLS Issuing ECC CA 4" })] }),
    );
    const r = await result;
    expect(fetch.calls).toHaveLength(2);
    expect(r).toMatchObject({ ok: true, status: "pass", tool: "cert_info" });
    expect(r.raw.certs[0]).toMatchObject({ sanMatch: true, daysToExpiry: 69, notAfter: "2026-12-24T12:35:14" });
    expect(r.summary).toBe("CT logs (best effort): valid until 2026-12-24 (69 days), issued by Cloudflare TLS Issuing ECC CA 4.");
  });

  it("puts matching certificates first, most days left first, deduplicated, at most 3", async () => {
    const shared = entry({ name: "shop.example.com\n*.example.com", notAfter: "2026-11-01T00:00:00", serial: "same" });
    const { result } = run(
      "shop.example.com",
      crt({
        "shop.example.com": [shared, entry({ name: "other.example.com", notAfter: "2027-06-01T00:00:00" }), entry({ name: "shop.example.com", notAfter: "2027-01-01T00:00:00" })],
        "*.example.com": [shared, entry({ name: "*.example.com", notAfter: "2026-12-01T00:00:00" })],
      }),
    );
    const r = await result;
    expect(r.raw.certs.map((c) => [c.notAfter.slice(0, 10), c.sanMatch])).toEqual([
      ["2027-01-01", true],
      ["2026-12-01", true],
      ["2026-11-01", true],
    ]);
  });

  it("fails when the newest certificate expires within 7 days", async () => {
    const { result } = run("example.com", crt({ "example.com": [entry({ name: "example.com", notAfter: "2026-10-20T00:00:00" })] }));
    const r = await result;
    expect(r).toMatchObject({ ok: true, status: "fail" });
    expect(r.summary).toContain("expires in 3 day(s)");
  });

  it("fails when no unexpired certificate covers the host", async () => {
    const { result } = run("example.com", crt({ "example.com": [entry({ name: "other.example.org", notAfter: "2027-01-01T00:00:00" })] }));
    const r = await result;
    expect(r).toMatchObject({ ok: true, status: "fail", summary: "CT logs (best effort): no unexpired certificate covers example.com." });
  });

  it.each([
    ["HTTP 502", () => new Response("bad gateway", { status: 502 })],
    ["HTML instead of JSON", () => new Response("<html>slow down</html>")],
    ["a network error", () => Promise.reject(new TypeError("connection reset"))],
  ])("is unavailable when crt.sh answers with %s (never a failure signal)", async (_name, h) => {
    const { result } = run("example.com", h as Handler);
    expect(await result).toMatchObject({ ok: false, status: "unavailable", summary: "Certificate info unavailable: crt.sh didn't answer." });
  });

  it("is unavailable, not 'missing', when one of the two queries failed and nothing matched", async () => {
    const { result } = run("shop.example.com", (url) => (url.searchParams.get("q")!.startsWith("*") ? new Response("", { status: 503 }) : Response.json([])));
    const r = await result;
    expect(r).toMatchObject({ ok: false, status: "unavailable" });
    expect(r.raw.failed).toEqual(["*.example.com"]);
  });

  it("uses the cache, and stores fresh answers in it", async () => {
    const store = new Map<string, string>();
    const cache = {
      match: async (url: RequestInfo | URL) => (store.has(String(url)) ? new Response(store.get(String(url))) : undefined),
      put: async (url: RequestInfo | URL, res: Response) => void store.set(String(url), await res.text()),
    };
    const h = crt({ "example.com": [entry({ name: "example.com", notAfter: "2027-01-01T00:00:00" })] });
    const first = run("example.com", h, { cache });
    expect((await first.result).status).toBe("pass");
    expect(first.fetch.calls).toHaveLength(1);
    const second = run("example.com", h, { cache });
    expect((await second.result).status).toBe("pass");
    expect(second.fetch.calls).toHaveLength(0);
  });

  it("keeps working when the cache throws", async () => {
    const cache = { match: async () => Promise.reject(new Error("no cache here")), put: async () => Promise.reject(new Error("no cache here")) };
    const { result } = run("example.com", crt({ "example.com": [entry({ name: "example.com", notAfter: "2027-01-01T00:00:00" })] }), { cache });
    expect((await result).status).toBe("pass");
  });
});
