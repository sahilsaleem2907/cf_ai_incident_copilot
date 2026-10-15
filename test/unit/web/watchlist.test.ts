import { describe, expect, it } from "vitest";
import { expiresIn, shortUrl } from "../../../web/components/WatchlistPanel";
import { addWatch, deleteWatch, listWatches, WATCH_ERROR_TEXT } from "../../../web/lib/api";

const fake = (status: number, body: unknown) => (async () => new Response(body === undefined ? null : JSON.stringify(body), { status })) as unknown as typeof fetch;
const offline = (async () => {
  throw new TypeError("Failed to fetch");
}) as unknown as typeof fetch;

describe("watch API client", () => {
  it("maps errors, and keeps the server's reason for a refused URL", async () => {
    expect(await addWatch("x", fake(409, { error: "watch_limit" }))).toEqual({ ok: false, error: "watch_limit" });
    expect(await addWatch("x", fake(400, { error: "invalid_url", message: "10.0.0.1 is a private or reserved address." }))).toEqual({
      ok: false,
      error: "invalid_url",
      message: "10.0.0.1 is a private or reserved address.",
    });
    expect(await addWatch("x", fake(500, { error: "boom" }))).toEqual({ ok: false, error: "server" });
    expect(await addWatch("x", offline)).toEqual({ ok: false, error: "network" });
    expect(await listWatches(offline)).toBeNull();
    expect(await deleteWatch("id", fake(204, undefined))).toBe(true);
    expect(await deleteWatch("id", fake(404, { error: "not_found" }))).toBe(false);
    for (const text of Object.values(WATCH_ERROR_TEXT)) expect(text).toBeTruthy();
  });
});

describe("watchlist text", () => {
  it("shortens URLs and words the expiry", () => {
    expect(shortUrl("https://api.example.com/")).toBe("api.example.com");
    expect(shortUrl("https://demo.example.dev/w/abc/")).toBe("demo.example.dev/w/abc/");
    const now = Date.UTC(2030, 0, 1);
    expect(expiresIn(now + 24 * 3_600_000, now)).toBe("ends in 24 h");
    expect(expiresIn(now + 90 * 60_000, now)).toBe("ends in 2 h");
    expect(expiresIn(now + 30 * 60_000, now)).toBe("ends within the hour");
  });
});
