import { describe, expect, it } from "vitest";
import { isBlockedIp } from "../../worker/safety/iprange";
import { followHops } from "../../worker/safety/reader";
import { checkUrlShape, createGuard, devAllowOrigin } from "../../worker/safety/ssrf";
import { dohHandler, fakeFetch } from "./helpers/fake-fetch";

describe("isBlockedIp: IPv4", () => {
  it.each([
    "0.0.0.0", "0.255.255.255", "10.0.0.1", "10.255.255.255", "100.64.0.1", "100.127.255.255",
    "127.0.0.1", "127.255.255.254", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.0.0.1",
    "192.0.2.5", "192.168.1.1", "198.18.0.1", "198.19.255.255", "198.51.100.7", "203.0.113.9",
    "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255",
  ])("blocks %s", (ip) => expect(isBlockedIp(ip)).toBe(true));

  it.each([
    "1.1.1.1", "8.8.8.8", "93.184.215.14", "9.255.255.255", "11.0.0.0", "100.63.255.255",
    "100.128.0.0", "172.15.255.255", "172.32.0.0", "192.167.255.255", "192.169.0.0",
    "198.17.255.255", "198.20.0.0", "223.255.255.255",
  ])("allows %s", (ip) => expect(isBlockedIp(ip)).toBe(false));
});

describe("isBlockedIp: IPv6", () => {
  it.each([
    "::", "::1", "[::1]", "::127.0.0.1", "fc00::1", "fd12:3456:789a::1", "fe80::1", "febf:ffff::1",
    "ff02::1", "64:ff9b::a00:1", "2001:db8::1", "2001:db8:ffff::1", "100::1",
    "::ffff:10.0.0.1", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe",
    "2002:a00:1::1", "2002:c0a8:101::1", "fe80::1%eth0",
  ])("blocks %s", (ip) => expect(isBlockedIp(ip)).toBe(true));

  it.each(["2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:1.1.1.1", "2002:808:808::1", "2a00:1450::1"])(
    "allows %s",
    (ip) => expect(isBlockedIp(ip)).toBe(false),
  );

  it.each(["not-an-ip", "1.2.3", "300.1.1.1", "1.2.3.4.5", "1::2::3", "12345::1", "", "::ffff:999.1.1.1"])(
    "fails closed on %j",
    (ip) => expect(isBlockedIp(ip)).toBe(true),
  );
});

describe("checkUrlShape", () => {
  it.each(["https://example.com/", "http://example.com:80/x?y=1", "https://example.com:443/", "https://Example.COM./a"])(
    "accepts %s",
    (url) => expect(checkUrlShape(url).ok).toBe(true),
  );

  it.each([
    ["not a url", "invalid_url"],
    ["ftp://example.com/", "scheme"],
    ["file:///etc/passwd", "scheme"],
    ["javascript:alert(1)", "scheme"],
    ["gopher://example.com/", "scheme"],
    ["https://example.com:8080/", "port"],
    ["http://example.com:22/", "port"],
    ["https://user:pw@example.com/", "credentials"],
    ["http://169.254.169.254/latest/meta-data", "ip_literal"],
    ["http://10.0.0.1/", "ip_literal"],
    ["http://1.1.1.1/", "ip_literal"],
    ["http://2130706433/", "ip_literal"],
    ["http://0x7f.0.0.1/", "ip_literal"],
    ["http://0177.0.0.1/", "ip_literal"],
    ["http://[::1]/", "ip_literal"],
    ["http://[::ffff:169.254.169.254]/", "ip_literal"],
    ["http://localhost/", "local_name"],
    ["http://LOCALHOST./", "local_name"],
    ["http://api.localhost/", "local_name"],
    ["http://printer.local/", "local_name"],
    ["http://metadata.google.internal/", "local_name"],
    ["http://intranet/", "local_name"],
  ])("refuses %s (%s)", (url, code) => {
    expect(checkUrlShape(url)).toMatchObject({ ok: false, code });
  });

  it("explains private IP literals clearly", () => {
    const r = checkUrlShape("http://169.254.169.254/");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain("private or reserved");
  });
});

describe("createGuard: DoH check", () => {
  const zone = {
    "public.example.com": { A: ["93.184.215.14"], AAAA: ["2606:2800:21f:cb07::1"] },
    "mixed.example.com": { A: ["93.184.215.14", "10.0.0.5"] },
    "v6private.example.com": { A: ["93.184.215.14"], AAAA: ["fd00::1"] },
    "cname.example.com": { CNAME: ["edge.cdn.example.net."], A: ["104.16.0.1"] },
    "empty.example.com": {},
    "rebind.example.com": { A: ["127.0.0.1"] },
  };

  it("allows a host whose answers are all public", async () => {
    const f = fakeFetch(dohHandler(zone));
    expect(await createGuard({ fetch: f })("https://public.example.com/")).toMatchObject({ ok: true });
    expect(f.calls).toHaveLength(2);
  });

  it.each([
    ["mixed.example.com", "private_address"],
    ["v6private.example.com", "private_address"],
    ["rebind.example.com", "private_address"],
    ["empty.example.com", "no_addresses"],
    ["missing.example.com", "no_addresses"],
  ])("refuses %s (%s)", async (host, code) => {
    const guard = createGuard({ fetch: fakeFetch(dohHandler(zone)) });
    expect(await guard(`https://${host}/`)).toMatchObject({ ok: false, code });
  });

  it("ignores CNAME answers and checks the addresses", async () => {
    const guard = createGuard({ fetch: fakeFetch(dohHandler(zone)) });
    expect(await guard("https://cname.example.com/")).toMatchObject({ ok: true });
  });

  it("fails closed when DoH errors", async () => {
    const guard = createGuard({ fetch: fakeFetch(() => new Response("oops", { status: 500 })) });
    expect(await guard("https://public.example.com/")).toMatchObject({ ok: false, code: "dns_error" });
  });

  it("caches per host: two DoH calls however many paths", async () => {
    const f = fakeFetch(dohHandler(zone));
    const guard = createGuard({ fetch: f });
    await guard("https://public.example.com/a");
    await guard("https://public.example.com/b");
    await guard("http://public.example.com/c");
    expect(f.calls).toHaveLength(2);
  });

  it("never resolves a URL that fails the shape check", async () => {
    const f = fakeFetch(dohHandler(zone));
    await createGuard({ fetch: f })("http://localhost/");
    expect(f.calls).toHaveLength(0);
  });
});

describe("redirect hops are re-checked", () => {
  const zone = {
    "public.example.com": { A: ["93.184.215.14"] },
    "evil.example.net": { A: ["10.0.0.1"] },
  };
  const site = (location: string) =>
    fakeFetch((url) =>
      url.hostname === "cloudflare-dns.com"
        ? dohHandler(zone)(url)
        : new Response(null, { status: 302, headers: { location } }),
    );

  it.each([
    ["http://169.254.169.254/latest/meta-data", "ip_literal"],
    ["https://evil.example.net/", "private_address"],
    ["http://localhost:8080/admin", "port"],
  ])("blocks a redirect to %s", async (location, code) => {
    const f = site(location);
    const result = await followHops(f, createGuard({ fetch: f }), "https://public.example.com/");
    expect(result.stop).toBe("blocked");
    expect(result.hops).toHaveLength(1);
    expect(result.blocked).toMatchObject({ code, url: new URL(location).toString() });
  });
});

describe("dev-only SSRF_DEV_ALLOW_ORIGIN", () => {
  const ALLOW = "http://localhost:8788";

  it("reads the setting only when it's a non-empty string", () => {
    expect(devAllowOrigin({})).toBeUndefined();
    expect(devAllowOrigin({ SSRF_DEV_ALLOW_ORIGIN: "" })).toBeUndefined();
    expect(devAllowOrigin({ SSRF_DEV_ALLOW_ORIGIN: ALLOW })).toBe(ALLOW);
  });

  it("lets the exact origin through without DNS", async () => {
    const f = fakeFetch(() => Response.json({ Status: 0, Answer: [] }));
    const r = await createGuard({ fetch: f, allowOrigin: ALLOW })("http://localhost:8788/w/abc/");
    expect(r).toMatchObject({ ok: true, devAllowed: true });
    expect(f.calls).toHaveLength(0);
  });

  it("blocks the same URL when the setting is off", () => {
    expect(checkUrlShape("http://localhost:8788/w/abc/")).toMatchObject({ ok: false, code: "port" });
  });

  it.each([
    "http://localhost:8789/",
    "https://localhost:8788/",
    "http://api.localhost:8788/",
    "http://127.0.0.1:8788/",
    "http://localhost/",
  ])("still blocks the near miss %s", (url) => {
    expect(checkUrlShape(url, ALLOW).ok).toBe(false);
  });

  it("ignores a malformed setting", () => {
    expect(checkUrlShape("http://localhost:8788/", "not a url").ok).toBe(false);
  });
});
