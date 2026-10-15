import { describe, expect, it } from "vitest";
import { assertInScope, OutOfScopeError, type Scope } from "../../worker/safety/origin";

const scope: Scope = { host: "Shop.Example.com", cnameTargets: ["shop.example.com.cdn.cloudflare.net."] };

describe("assertInScope (D6)", () => {
  it.each([
    ["http_probe", { url: "https://shop.example.com/" }],
    ["http_probe", { url: "https://SHOP.example.com/checkout?x=1" }],
    ["http_probe", { url: "http://shop.example.com/static/app.js" }],
    ["dns_lookup", { hostname: "shop.example.com" }],
    ["dns_lookup", { hostname: "shop.example.com.cdn.cloudflare.net" }],
    ["cert_info", { hostname: "SHOP.EXAMPLE.COM." }],
    ["cert_info", { hostname: "shop.example.com.cdn.cloudflare.net" }],
    ["provider_status", { providers: ["cloudflare"] }],
    ["submit_findings", {}],
  ])("allows %s %j", (tool, args) => {
    expect(() => assertInScope(tool, args, scope)).not.toThrow();
  });

  it.each([
    ["http_probe", { url: "https://other.example.com/" }],
    ["http_probe", { url: "https://shop.example.com.evil.net/" }],
    ["http_probe", { url: "https://shop.example.com.cdn.cloudflare.net/" }],
    ["http_probe", { url: "not a url" }],
    ["http_probe", {}],
    ["dns_lookup", { hostname: "example.com" }],
    ["dns_lookup", { hostname: "attacker.example.net" }],
    ["cert_info", { hostname: 42 }],
    ["fetch_anything", { url: "https://shop.example.com/" }],
  ])("refuses %s %j", (tool, args) => {
    expect(() => assertInScope(tool, args, scope)).toThrow(OutOfScopeError);
  });

  it("names the out-of-scope host so the UI can offer a new incident", () => {
    expect(() => assertInScope("http_probe", { url: "https://other.example.com/" }, scope)).toThrow(/other\.example\.com/);
  });
});
