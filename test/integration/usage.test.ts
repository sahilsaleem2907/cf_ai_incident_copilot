import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { d1Usage } from "../../worker/llm/usage";
import { NEURON_DAILY } from "../../worker/loop/budget";

// Fixed days per test so the shared D1 doesn't leak counts between them.
const at = (iso: string) => () => Date.parse(iso);

describe("d1Usage (llm_usage)", () => {
  it("adds neurons per UTC day, rounding each call up", async () => {
    const day1 = d1Usage(env.DB, at("2030-01-01T23:59:00Z"));
    await day1.add(14.2);
    await day1.add(0.4);
    expect(await day1.today()).toBe(16);

    const day2 = d1Usage(env.DB, at("2030-01-02T00:01:00Z"));
    expect(await day2.today()).toBe(0);
    await day2.add(3);
    expect(await day2.today()).toBe(3);
    expect(await day1.today()).toBe(16);
  });

  it("marks the day as spent when the allocation runs out, without lowering a higher total", async () => {
    const u = d1Usage(env.DB, at("2030-02-01T12:00:00Z"));
    await u.add(120);
    await u.exhausted();
    expect(await u.today()).toBe(NEURON_DAILY);
    await u.add(5);
    await u.exhausted();
    expect(await u.today()).toBe(NEURON_DAILY + 5);
  });

  it("never throws on a write error", async () => {
    const broken = { prepare: () => ({ bind: () => ({ run: () => Promise.reject(new Error("D1 down")) }) }) } as unknown as D1Database;
    await expect(d1Usage(broken).add(1)).resolves.toBeUndefined();
  });
});
