import { describe, expect, it } from "vitest";
import { checkCitations } from "../../worker/llm/citations";
import { mockCall } from "../../worker/llm/mock";
import { LlmUnavailable } from "../../worker/llm/models";
import { narrationSystem, narrationUser, planningSystem, planningUser, type EvidenceLine } from "../../worker/llm/prompts";
import { parseFindings } from "../../worker/loop/findings";
import { llmTools } from "../../worker/tools/registry";

const target = "https://incident-copilot-demo.example.workers.dev/w/abc/";
const dns: EvidenceLine = { evidenceId: "dns-1", tool: "dns_lookup", status: "pass", summary: "104.21.1.1 · both resolvers agree", digest: '{"host":"incident-copilot-demo.example.workers.dev","mismatch":false}' };
const http = (summary: string, status: EvidenceLine["status"] = "fail", digest = '{"asset":null}'): EvidenceLine => ({ evidenceId: "http-1", tool: "http_probe", status, summary, digest });
const okAsset = '{"asset":{"url":"https://x/w/abc/static/app.js","status":200,"cacheControl":"public, max-age=31536000, immutable","setCookie":false}}';

function plan(question: string, evidence: EvidenceLine[]) {
  return mockCall({ system: planningSystem({ target, toolsLeft: 6, turnsLeft: 3 }), messages: planningUser({ question, evidence }), tools: llmTools(), toolChoice: "required", maxTokens: 800 });
}

describe("mock LLM: planning", () => {
  it("first turn checks DNS and HTTP for the target", () => {
    const r = plan("what's wrong with my demo?", []);
    expect(r).toMatchObject({ model: "mock", usage: { neurons: 0 } });
    expect(r.toolCalls.map((c) => [c.name, c.args])).toEqual([
      ["dns_lookup", { hostname: "incident-copilot-demo.example.workers.dev" }],
      ["http_probe", { url: target }],
    ]);
  });

  // Summaries in the exact form `http_probe` writes them (worker/tools/http.ts judge()).
  it.each([
    ["healthy", http("HTTP 200 · median 120 ms (TTFB 80 ms)", "pass", okAsset)],
    ["origin_5xx", http("HTTP 500/500/500 on 3 samples · median 40 ms (TTFB 30 ms)")],
    ["high_latency", http("Slow: median 3012 ms (TTFB 3005 ms)", "fail", okAsset)],
    ["redirect_loop", http("Redirect loop after 2 hops.")],
    ["cache_misconfiguration", http("HTTP 200 · median 90 ms (TTFB 60 ms)", "pass", '{"asset":{"url":"https://x/w/abc/static/app.js","status":200,"cacheControl":"no-store","setCookie":true}}')],
    ["inconclusive", http("Timed out on 3/3 samples.")],
  ])("then submits %s findings that pass the schema", (category, line) => {
    const r = plan("what's wrong?", [dns, line]);
    expect(r.toolCalls.map((c) => c.name)).toEqual(["submit_findings"]);
    const parsed = parseFindings(r.toolCalls[0]!.args);
    expect(parsed).toMatchObject({ ok: true, findings: { category, evidence: ["http-1", "dns-1"] } });
    if (parsed.ok) expect(parsed.findings.actions).toEqual(category === "healthy" ? [] : ["restore_demo_service"]);
  });

  it("reads DNS failures and mismatches", () => {
    const failing = { ...dns, status: "fail" as const, summary: "NXDOMAIN: the name doesn't resolve." };
    expect(parseFindings(plan("q", [failing]).toolCalls[0]!.args)).toMatchObject({ findings: { category: "dns_failure", evidence: ["dns-1"] } });
    const split = { ...dns, status: "fail" as const, summary: "Resolvers disagree: cloudflare NOERROR, google NXDOMAIN." };
    expect(parseFindings(plan("q", [split, http("HTTP 404 · median 50 ms (TTFB 40 ms)")]).toolCalls[0]!.args)).toMatchObject({ findings: { category: "dns_mismatch" } });
  });

  it("#llm-invalid returns a call whose arguments don't parse", () => {
    const r = plan("diagnose demo #llm-invalid", [dns]);
    expect(r.toolCalls[0]).toMatchObject({ name: "http_probe", args: null, argsError: expect.any(String) });
  });

  it("#llm-down throws LlmUnavailable", () => {
    expect(() => plan("diagnose demo #llm-down", [])).toThrow(LlmUnavailable);
  });
});

describe("mock LLM: narration", () => {
  it("writes four cited sections that survive the citation check", () => {
    const evidence = [dns, http("HTTP 500/500/500 on 3 samples · median 40 ms (TTFB 30 ms)")];
    const findings = { category: "origin_5xx" as const, confidence: "high" as const, evidence: ["http-1", "dns-1"], cause: "Mock diagnosis: The origin returns 5xx on most samples.", next_steps: ["Check logs."], actions: ["restore_demo_service" as const] };
    const r = mockCall({ system: narrationSystem(), messages: narrationUser({ question: "q", findings, evidence }), maxTokens: 600 });
    expect(r.text).toContain("**Likely cause:**");
    expect(r.text).toContain("- HTTP probe: HTTP 500/500/500 on 3 samples · median 40 ms (TTFB 30 ms) [http-1]");
    expect(r.text).not.toContain("restore_demo_service");
    expect(checkCitations(r.text!, ["http-1", "dns-1"]).removed).toBe(0);
  });
});
