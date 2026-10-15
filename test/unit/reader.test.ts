import { describe, expect, it } from "vitest";
import { followHops, readOnce, READ_CAP, MAX_HOPS } from "../../worker/safety/reader";
import type { Guard } from "../../worker/safety/ssrf";
import { fakeFetch } from "./helpers/fake-fetch";

const allowAll: Guard = async (url) => ({ ok: true, url: new URL(url) });

describe("readOnce", () => {
  it("caps the body at 16 KB and marks it truncated", async () => {
    const f = fakeFetch(() => new Response("x".repeat(READ_CAP + 5000)));
    const r = await readOnce(f, "https://example.com/");
    expect(r.ok && r.body.length).toBe(READ_CAP);
    expect(r.ok && r.truncated).toBe(true);
  });

  it("returns small bodies whole", async () => {
    const r = await readOnce(fakeFetch(() => new Response("hello")), "https://example.com/");
    expect(r).toMatchObject({ ok: true, status: 200, body: "hello", truncated: false });
  });

  it("never follows redirects itself and sends no user headers", async () => {
    let seen: RequestInit | undefined;
    const f = fakeFetch((_, init) => {
      seen = init;
      return new Response(null, { status: 302, headers: { location: "/next" } });
    });
    const r = await readOnce(f, "https://example.com/", "HEAD");
    expect(r).toMatchObject({ ok: true, status: 302, location: "/next" });
    expect(seen).toMatchObject({ method: "HEAD", redirect: "manual" });
    expect(Object.keys(seen!.headers as Record<string, string>).sort()).toEqual(["accept", "user-agent"]);
    expect(f.calls).toHaveLength(1);
  });

  it("reports a timeout", async () => {
    const f = fakeFetch(
      (_, init) => new Promise<Response>((_, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason))),
    );
    expect(await readOnce(f, "https://slow.example.com/", "GET", { timeoutMs: 20 })).toMatchObject({ ok: false, error: "timeout" });
  });

  it("reports network errors", async () => {
    const f = fakeFetch(() => Promise.reject(new TypeError("connection refused")));
    expect(await readOnce(f, "https://down.example.com/")).toMatchObject({ ok: false, error: "network" });
  });
});

describe("followHops", () => {
  const redirects = (map: Record<string, string>) =>
    fakeFetch((url) => {
      const to = map[url.toString()];
      return to ? new Response(null, { status: 301, headers: { location: to } }) : new Response("final page");
    });

  it("follows relative and absolute locations to the final page", async () => {
    const f = redirects({ "https://a.example.com/": "/login", "https://a.example.com/login": "https://b.example.com/home" });
    const r = await followHops(f, allowAll, "https://a.example.com/");
    expect(r.stop).toBe("done");
    expect(r.hops.map((h) => h.url)).toEqual(["https://a.example.com/", "https://a.example.com/login", "https://b.example.com/home"]);
    expect(r.final).toMatchObject({ status: 200, body: "final page" });
  });

  it("stops on a loop", async () => {
    const f = redirects({ "https://a.example.com/": "/r", "https://a.example.com/r": "/" });
    const r = await followHops(f, allowAll, "https://a.example.com/");
    expect(r.stop).toBe("loop");
    expect(r.hops).toHaveLength(2);
    expect(f.calls).toHaveLength(2);
  });

  it(`stops after 1 + ${MAX_HOPS} requests`, async () => {
    const chain = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`https://a.example.com/${i}`, `/${i + 1}`]));
    const f = redirects(chain);
    const r = await followHops(f, allowAll, "https://a.example.com/0");
    expect(r.stop).toBe("max_hops");
    expect(f.calls).toHaveLength(MAX_HOPS + 1);
  });

  it("checks every hop with the guard", async () => {
    const checked: string[] = [];
    const guard: Guard = async (url) => {
      checked.push(url);
      return { ok: true, url: new URL(url) };
    };
    const f = redirects({ "https://a.example.com/": "/x" });
    await followHops(f, guard, "https://a.example.com/");
    expect(checked).toEqual(["https://a.example.com/", "https://a.example.com/x"]);
  });

  it("does not treat a 3xx without Location as a redirect", async () => {
    const r = await followHops(fakeFetch(() => new Response(null, { status: 304 })), allowAll, "https://a.example.com/");
    expect(r).toMatchObject({ stop: "done", final: { status: 304 } });
  });
});
