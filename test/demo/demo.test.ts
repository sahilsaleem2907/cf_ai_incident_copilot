import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { newId } from "../../worker/lib/ids";
import type { DemoAdmin } from "../../demo-service/src/index";
import { SLOW_DELAY_MS } from "../../demo-service/src/pages";

// `exports` is typed for the main Worker; this project runs the demo Worker.
const demo = exports as unknown as { default: Fetcher; DemoAdmin: Service<typeof DemoAdmin> };
const BASE = "https://demo.example.com";
const admin = demo.DemoAdmin;
const get = (path: string) => demo.default.fetch(`${BASE}${path}`, { redirect: "manual" });

// Awaited in try/catch: `expect(rpcPromise).rejects` leaves a pipelined RPC promise unhandled.
async function errorOf(p: PromiseLike<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected the call to fail");
}

async function workspace(mode?: Parameters<typeof admin.setMode>[1]): Promise<string> {
  const ws = newId();
  if (mode) await admin.setMode(ws, mode);
  return ws;
}

describe("demo service: routes", () => {
  it("serves a plain info page at /", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("/w/<workspace>/");
  });

  it("404s malformed workspaces and unknown paths", async () => {
    const ws = await workspace();
    for (const path of ["/w/not-an-id/", "/w/", `/w/${ws}`, `/w/${ws}/nope`, `/w/${ws}/static/other.js`]) {
      expect((await get(path)).status, path).toBe(404);
    }
  });

  it("has no admin route over HTTP", async () => {
    const ws = await workspace();
    for (const path of ["/admin", `/w/${ws}/mode`, "/api/demo/mode"]) {
      expect((await demo.default.fetch(`${BASE}${path}`, { method: "POST", body: '{"mode":"errors"}' })).status).toBe(404);
    }
    expect(await admin.getMode(ws)).toBe("healthy");
  });
});

describe("demo service: DemoAdmin RPC", () => {
  it("defaults to healthy and remembers the mode per workspace", async () => {
    const a = await workspace();
    const b = await workspace();
    expect(await admin.getMode(a)).toBe("healthy");
    expect(await admin.setMode(a, "errors")).toBe("errors");
    expect(await admin.getMode(a)).toBe("errors");
    expect(await admin.getMode(b)).toBe("healthy");
    expect((await get(`/w/${a}/`)).status).toBe(500);
    expect((await get(`/w/${b}/`)).status).toBe(200);
  });

  it("rejects an unknown mode or a malformed workspace", async () => {
    const ws = await workspace();
    expect(await errorOf(admin.setMode(ws, "on_fire" as never))).toContain("invalid_mode");
    expect(await errorOf(admin.setMode("not-an-id", "errors"))).toContain("invalid_workspace");
    expect(await errorOf(admin.getMode("../x"))).toContain("invalid_workspace");
    expect(await admin.getMode(ws)).toBe("healthy");
  });

  it("serves the same pages through the binding entrypoint", async () => {
    const ws = await workspace("errors");
    expect((await admin.fetch(`${BASE}/w/${ws}/`)).status).toBe(500);
  });
});

describe("demo service: modes (TDD §7.5)", () => {
  it("healthy: cacheable page and assets, no cookies", async () => {
    const ws = await workspace("healthy");
    const page = await get(`/w/${ws}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    expect(page.headers.has("set-cookie")).toBe(false);
    const html = await page.text();
    expect(html).toContain(`<link rel="stylesheet" href="/w/${ws}/static/app.css">`);
    expect(html).toContain(`<script src="/w/${ws}/static/app.js"`);

    for (const file of ["app.css", "app.js"]) {
      const asset = await get(`/w/${ws}/static/${file}`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(asset.headers.has("set-cookie")).toBe(false);
    }
    // Outside redirect_loop, /r just leads back to the page.
    const r = await get(`/w/${ws}/r`);
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe(`/w/${ws}/`);
  });

  it(`slow: waits ${SLOW_DELAY_MS} ms, then answers like healthy`, async () => {
    const ws = await workspace("slow");
    const start = Date.now();
    const res = await get(`/w/${ws}/`);
    expect(Date.now() - start).toBeGreaterThanOrEqual(SLOW_DELAY_MS);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
  });

  it("errors: 500 on every path", async () => {
    const ws = await workspace("errors");
    for (const path of [`/w/${ws}/`, `/w/${ws}/static/app.css`, `/w/${ws}/r`]) {
      expect((await get(path)).status, path).toBe(500);
    }
  });

  it("redirect_loop: the page and /r send 302s to each other", async () => {
    const ws = await workspace("redirect_loop");
    const first = await get(`/w/${ws}/`);
    expect(first.status).toBe(302);
    expect(first.headers.get("location")).toBe(`/w/${ws}/r`);
    const second = await get(`/w/${ws}/r`);
    expect(second.status).toBe(302);
    expect(second.headers.get("location")).toBe(`/w/${ws}/`);
  });

  it("bad_cache: no-store assets and a cookie on every response", async () => {
    const ws = await workspace("bad_cache");
    const page = await get(`/w/${ws}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    expect(page.headers.get("set-cookie")).toMatch(new RegExp(`^demo_session=[0-9a-f-]{36}; Path=/w/${ws}/$`));

    const asset = await get(`/w/${ws}/static/app.js`);
    expect(asset.headers.get("cache-control")).toBe("no-store");
    expect(asset.headers.get("set-cookie")).toMatch(/^demo_session=/);
  });
});
