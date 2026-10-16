import { describe, expect, it } from "vitest";
import { parseTarget } from "../../worker/safety/target";
import { normalizeTranscript } from "../../worker/voice/normalize";

describe("voice transcript normalisation (WP-23)", () => {
  it.each([
    ["is demo dot example dot com down", "is demo.example.com down"],
    ["Is demo dot example dot com down?", "Is demo.example.com down?"],
    ["check api dot shop dot example dot co dot uk", "check api.shop.example.co.uk"],
    ["Is Shop.Example.COM slow?", "Is shop.example.com slow?"],
    ["probe example dot com slash checkout slash pay", "probe example.com/checkout/pay"],
    ["Demo, dot, example, dot com is down", "demo.example.com is down"],
    ["  what's   wrong with my demo service?  ", "what's wrong with my demo service?"],
  ])("%j → %j", (input, want) => {
    expect(normalizeTranscript(input)).toBe(want);
  });

  it("leaves ordinary words alone", () => {
    expect(normalizeTranscript("Dot the i's. Slash prices now")).toBe("Dot the i's. Slash prices now");
  });

  it("the done-when phrase becomes a target the parser finds", () => {
    const r = parseTarget(normalizeTranscript("is demo dot example dot com down"), "https://demo.invalid/");
    expect(r).toMatchObject({ ok: true, host: "demo.example.com" });
  });
});
