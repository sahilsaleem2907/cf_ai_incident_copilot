import { describe, expect, it } from "vitest";
import { probeLimiter } from "../../worker/safety/quota";

const DEMO = "https://incident-copilot-demo.example.workers.dev";

/** A PROBE_LIMIT stand-in: `limit` successes per key, recording every key it was asked about. */
function fakeLimit(limit: number) {
  const counts = new Map<string, number>();
  const binding = {
    limit: async ({ key }: { key: string }) => {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return { success: counts.get(key)! <= limit };
    },
  } as unknown as RateLimit;
  return { binding, counts };
}

describe("probeLimiter", () => {
  it("limits per hostname", async () => {
    const { binding } = fakeLimit(2);
    const allow = probeLimiter({ PROBE_LIMIT: binding, DEMO_BASE_URL: DEMO });
    expect([await allow("shop.example.com"), await allow("shop.example.com"), await allow("shop.example.com")]).toEqual([true, true, false]);
    expect(await allow("other.example.com")).toBe(true);
  });

  it("never limits our own demo or the dev allow-origin, and doesn't count them", async () => {
    const { binding, counts } = fakeLimit(0);
    const allow = probeLimiter({ PROBE_LIMIT: binding, DEMO_BASE_URL: DEMO, SSRF_DEV_ALLOW_ORIGIN: "http://localhost:5173" } as Pick<Env, "PROBE_LIMIT" | "DEMO_BASE_URL">);
    expect(await allow("incident-copilot-demo.example.workers.dev")).toBe(true);
    expect(await allow("localhost")).toBe(true);
    expect(counts.size).toBe(0);
    expect(await allow("shop.example.com")).toBe(false);
  });

  it("ignores a placeholder demo URL and fails open when the binding errors", async () => {
    const binding = { limit: async () => Promise.reject(new Error("down")) } as unknown as RateLimit;
    expect(await probeLimiter({ PROBE_LIMIT: binding, DEMO_BASE_URL: "https://incident-copilot-demo.<sub>.workers.dev" })("shop.example.com")).toBe(true);
  });
});
