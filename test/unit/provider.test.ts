import { describe, expect, it } from "vitest";
import { decodeText, parseAws, parseStatuspage, runProviderStatus } from "../../worker/tools/provider";
import { byHost, fakeFetch } from "./helpers/fake-fetch";

const statuspage = (incidents: { name: string; impact: string; status?: string }[]) => () =>
  Response.json({ page: { id: "x" }, incidents: incidents.map((i) => ({ status: "investigating", shortlink: "https://stspg.io/x", ...i })) });

/** AWS sends its feed as UTF-16 big-endian with a byte-order mark (WP-21 spike). */
function utf16be(text: string): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  out[0] = 0xfe;
  out[1] = 0xff;
  for (let i = 0; i < text.length; i++) {
    out[2 + 2 * i] = text.charCodeAt(i) >> 8;
    out[3 + 2 * i] = text.charCodeAt(i) & 0xff;
  }
  return out;
}
const NOW = Date.parse("2026-10-16T12:00:00Z");
const hoursAgo = (h: number) => String(Math.floor((NOW - h * 3_600_000) / 1000));
const awsEvent = (region: string, date = hoursAgo(2)) =>
  `{"date":"${date}","arn":"arn:aws:health:x","region_name":"${region}","status":"3","service":"multipleservices-x","service_name":"Multiple services","summary":"Region Availability","event_log":[{"summary":"Increased Error Rates","message":"${"We are investigating. ".repeat(40)}"}]}`;

const run = (providers: ("cloudflare" | "github" | "aws")[], hosts: Parameters<typeof byHost>[0]) =>
  runProviderStatus({ providers }, { fetch: fakeFetch(byHost(hosts)), evidenceId: "status-1", now: () => NOW });

describe("provider_status parsing", () => {
  it("decodes UTF-16 (both byte orders) and plain UTF-8", () => {
    expect(decodeText(utf16be('[{"a":"é"}]'))).toBe('[{"a":"é"}]');
    const le = utf16be("hi").map((_, i, a) => (i < 2 ? [0xff, 0xfe][i]! : i % 2 ? a[i - 1]! : a[i + 1]!));
    expect(decodeText(le)).toBe("hi");
    expect(decodeText(new TextEncoder().encode("plain"))).toBe("plain");
  });

  it("parses Statuspage incidents with impact", () => {
    expect(parseStatuspage(JSON.stringify({ incidents: [{ name: "Dashboard  sign up issues", status: "investigating", impact: "minor" }] }))).toEqual([
      { name: "Dashboard sign up issues", status: "investigating", impact: "minor" },
    ]);
    expect(parseStatuspage("<html>")).toBeNull();
  });

  it("reads AWS events from a whole feed, or from the part that fit the read cap; events older than a day are 'ongoing'", () => {
    const feed = `[${awsEvent("UAE", hoursAgo(5000))},${awsEvent("Bahrain")}]`;
    const want = [
      { name: "Multiple services: Region Availability (UAE)", status: "3", impact: "ongoing" },
      { name: "Multiple services: Region Availability (Bahrain)", status: "3" },
    ];
    expect(parseAws(feed, false, NOW)).toEqual(want);
    expect(parseAws(feed.slice(0, feed.length - 400), true, NOW)).toEqual(want);
    expect(parseAws("[]", false, NOW)).toEqual([]);
  });
});

describe("provider_status", () => {
  it("passes when no provider has a major incident, listing minor ones", async () => {
    const r = await run(["cloudflare", "github"], {
      "www.cloudflarestatus.com": statuspage([{ name: "Dashboard sign up issues", impact: "minor" }]),
      "www.githubstatus.com": statuspage([]),
    });
    expect(r).toMatchObject({ ok: true, status: "pass", tool: "provider_status" });
    expect(r.summary).toBe("Cloudflare: no outage (1 minor or long-running incident(s)) · GitHub: no active incidents.");
    expect(r.raw.providers.cloudflare?.active[0]).toMatchObject({ impact: "minor" });
  });

  it("fails on a major incident", async () => {
    const r = await run(["cloudflare"], { "www.cloudflarestatus.com": statuspage([{ name: "Elevated 5xx in LHR", impact: "major" }]) });
    expect(r).toMatchObject({ status: "fail", summary: 'Cloudflare: 1 active incident(s), "Elevated 5xx in LHR".' });
  });

  it("reads the AWS feed (UTF-16), and a provider that doesn't answer leaves the others counted", async () => {
    const r = await run(["github", "aws"], {
      "www.githubstatus.com": () => new Response("down", { status: 503 }),
      "health.aws.amazon.com": () => new Response(utf16be(`[${awsEvent("UAE")},${awsEvent("Bahrain", hoursAgo(5000))}]`)),
    });
    expect(r).toMatchObject({ ok: true, status: "fail", raw: { unavailable: ["github"] } });
    expect(r.summary).toBe('AWS: 1 active incident(s), "Multiple services: Region Availability (UAE)" · GitHub: no answer.');
  });

  it("only long-running AWS events (WP-26: months-old regional events made healthy sites look failing) → no outage", async () => {
    const r = await run(["aws"], { "health.aws.amazon.com": () => new Response(utf16be(`[${awsEvent("UAE", hoursAgo(5000))},${awsEvent("Bahrain", hoursAgo(25))}]`)) });
    expect(r).toMatchObject({ ok: true, status: "pass", summary: "AWS: no outage (2 minor or long-running incident(s))." });
  });

  it("is unavailable when no status page answers", async () => {
    const r = await run(["cloudflare", "github"], {});
    expect(r).toMatchObject({ ok: false, status: "unavailable", raw: { unavailable: ["cloudflare", "github"] } });
  });
});
