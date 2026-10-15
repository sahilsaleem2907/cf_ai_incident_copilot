import { describe, expect, it } from "vitest";
import { DemoModesSchema, modesFrom, normalizeModes } from "../../demo-service/src/modes";

describe("demo mode combinations", () => {
  it("allows healthy alone, or one main problem plus an optional slow", () => {
    expect(normalizeModes(["healthy"])).toEqual(["healthy"]);
    expect(normalizeModes(["slow"])).toEqual(["slow"]);
    expect(normalizeModes(["redirect_loop", "slow"])).toEqual(["slow", "redirect_loop"]);
    expect(normalizeModes(["errors", "errors"])).toEqual(["errors"]);
  });

  it("refuses empty sets and combinations that can't exist together", () => {
    expect(normalizeModes([])).toBeNull();
    expect(normalizeModes(["healthy", "errors"])).toBeNull();
    expect(normalizeModes(["healthy", "slow"])).toBeNull();
    expect(normalizeModes(["errors", "redirect_loop"])).toBeNull();
    expect(normalizeModes(["errors", "bad_cache"])).toBeNull();
    expect(normalizeModes(["redirect_loop", "bad_cache", "slow"])).toBeNull();
  });

  it("builds a valid set from the panel's controls", () => {
    expect(modesFrom(null, false)).toEqual(["healthy"]);
    expect(modesFrom(null, true)).toEqual(["slow"]);
    expect(modesFrom("errors", false)).toEqual(["errors"]);
    expect(modesFrom("bad_cache", true)).toEqual(["slow", "bad_cache"]);
  });

  it("validates untrusted input with zod", () => {
    expect(DemoModesSchema.safeParse(["bad_cache", "slow"]).data).toEqual(["slow", "bad_cache"]);
    for (const input of [["on_fire"], "errors", ["healthy", "errors"], null]) {
      expect(DemoModesSchema.safeParse(input).success).toBe(false);
    }
  });
});
