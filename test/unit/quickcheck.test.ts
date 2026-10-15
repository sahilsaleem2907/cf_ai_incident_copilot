import { describe, expect, it } from "vitest";
import { quickCheck, QUICKCHECK_CAP } from "../../worker/tools/quickcheck";
import { byHost, dohHandler, fakeClock, fakeFetch, type Handler } from "./helpers/fake-fetch";

const DNS = dohHandler({ "shop.example.com": { A: ["93.184.215.14"] }, "evil.example.net": { A: ["192.168.1.1"] } });
const check = (site: Handler, clock = fakeClock()) => {
  const f = fakeFetch(byHost({ "cloudflare-dns.com": DNS, "shop.example.com": site }));
  return quickCheck("https://shop.example.com/", { fetch: f, now: clock.now });
};

describe("quickCheck", () => {
  it("passes on a fast 200 and costs 3 subrequests", async () => {
    expect(await check(() => new Response("ok"))).toEqual({ pass: true, status: 200, totalMs: 0, stop: "done", subrequests: 3 });
  });

  it("fails on 5xx", async () => {
    expect(await check(() => new Response("x", { status: 503 }))).toMatchObject({ pass: false, status: 503, reason: "http_503" });
  });

  it("fails when slow", async () => {
    const clock = fakeClock();
    expect(await check(() => (clock.advance(2500), new Response("ok")), clock)).toMatchObject({ pass: false, status: 200, reason: "slow" });
  });

  it("fails when a redirect is blocked", async () => {
    const r = await check(() => new Response(null, { status: 302, headers: { location: "https://evil.example.net/" } }));
    expect(r).toMatchObject({ pass: false, stop: "blocked", reason: "private_address" });
  });

  it("stays within its cap", async () => {
    const r = await check((url) => new Response(null, { status: 302, headers: { location: `${url.pathname}x` } }));
    expect(r.pass).toBe(false);
    expect(r.subrequests).toBeLessThanOrEqual(QUICKCHECK_CAP);
  });
});
