import { describe, expect, it } from "vitest";
import { parseTarget } from "../../worker/safety/target";

const DEMO = "https://incident-copilot-demo.example.workers.dev/w/0123456789abcdef0123456789abcdef/";

describe("parseTarget", () => {
  it.each([
    // URL first
    ["https://api.example.com/health is 502ing", "https://api.example.com/health", "api.example.com", "url"],
    ["check http://Example.COM:8080/a?b=1#frag.", "http://example.com:8080/a?b=1", "example.com", "url"],
    ["(see https://x.example.org/path)", "https://x.example.org/path", "x.example.org", "url"],
    ["https://user:secret@example.com/ down", "https://example.com/", "example.com", "url"],
    ["demo vs https://other.example.net", "https://other.example.net/", "other.example.net", "url"],
    // Host token next
    ["diagnose cloudflare.com", "https://cloudflare.com/", "cloudflare.com", "host"],
    ["is API.Example.com slow?", "https://api.example.com/", "api.example.com", "host"],
    ["checkout.example.com. is throwing errors", "https://checkout.example.com/", "checkout.example.com", "host"],
    ["check demo.example.com please", "https://demo.example.com/", "demo.example.com", "host"],
    ["ftp://files.example.com is down", "https://files.example.com/", "files.example.com", "host"],
    ["e.g. index.html fails on shop.example.io", "https://shop.example.io/", "shop.example.io", "host"],
    // Spoken "dot" (voice transcripts)
    ["is demo dot example dot com down", "https://demo.example.com/", "demo.example.com", "host"],
    ["Is Checkout Dot Example Dot Com up?", "https://checkout.example.com/", "checkout.example.com", "host"],
    // Private targets are extracted so the SSRF guard can refuse them clearly
    ["probe http://169.254.169.254/latest/meta-data", "http://169.254.169.254/latest/meta-data", "169.254.169.254", "url"],
    ["is 10.0.0.1 up", "https://10.0.0.1/", "10.0.0.1", "host"],
    ["what about localhost:3000", "https://localhost/", "localhost", "host"],
    ["http://localhost:8787/", "http://localhost:8787/", "localhost", "url"],
    // Demo keyword last
    ["what's wrong with my demo service?", DEMO, "incident-copilot-demo.example.workers.dev", "demo"],
    ["DEMO is slow", DEMO, "incident-copilot-demo.example.workers.dev", "demo"],
  ])("%s", (message, url, host, source) => {
    expect(parseTarget(message, DEMO)).toEqual({ ok: true, url, host, source });
  });

  it.each([
    [""],
    ["my site is down"],
    ["the build at 1.2.3 fails"],
    ["read index.html and app.js"],
    ["999.1.1.1 is not an address"],
    ["demonstrate the problem"],
  ])("needs a target: %j", (message) => {
    expect(parseTarget(message, DEMO)).toEqual({ ok: false, error: "need_target" });
  });
});
