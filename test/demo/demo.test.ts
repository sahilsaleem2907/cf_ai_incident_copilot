import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("demo service", () => {
  it("serves a page", async () => {
    const res = await exports.default.fetch("https://demo.example.com/");
    expect(res.status).toBe(200);
  });
});
