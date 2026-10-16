import { CATEGORY_INFO, type Category, type Findings } from "../diagnosis/categories";
import { renderTemplate } from "../diagnosis/template";
import type { ToolResult } from "../tools/types";
import { LlmUnavailable, toResult, type ChatCompletion, type LlmRequest, type LlmResult } from "./models";
import type { EvidenceLine } from "./prompts";

/**
 * `LLM_MODE=mock` (TDD §7.4): scripted turns in the recorded chat-completions shape, run through the real
 * mapper, costing 0 neurons. A demo URL doesn't show its mode, so the final turn reads the evidence instead
 * of keying on the target. Test triggers in the question: `#llm-down`, `#llm-invalid`.
 */
export const MOCK_MODEL = "mock";

const LINE = /^\[([a-z]+-\d+)\] (\w+) \((\w+)\): (.*)\n {2}(.*)$/gm;

export function mockCall(req: LlmRequest): LlmResult {
  const user = req.messages.map((m) => m.content).join("\n");
  if (user.includes("#llm-down")) throw new LlmUnavailable("failed", "mock: #llm-down");
  if (req.tools?.length) return toResult(MOCK_MODEL, planningTurn(req.system, user));
  return { text: narration(user), toolCalls: [], usage: { in: 0, out: 0, neurons: 0 }, model: MOCK_MODEL, fallback: false };
}

export function mockStream(req: LlmRequest, onDelta: (text: string) => void): LlmResult {
  const result = mockCall(req);
  const text = result.text ?? "";
  const size = Math.max(1, Math.ceil(text.length / 4));
  for (let i = 0; i < text.length; i += size) onDelta(text.slice(i, i + size));
  return result;
}

function planningTurn(system: string, user: string): ChatCompletion {
  if (user.includes("#llm-invalid")) return completion([{ name: "http_probe", args: "{not json" }]);
  const evidence = parseEvidence(user);
  if (evidence.length === 0) {
    const target = /^Target: (\S+)$/m.exec(system)?.[1] ?? "https://example.com/";
    return completion([
      { name: "dns_lookup", args: JSON.stringify({ hostname: new URL(target).hostname }) },
      { name: "http_probe", args: JSON.stringify({ url: target }) },
    ]);
  }
  const category = pickCategory(evidence);
  const decisive = category === "tls_expiry" ? last(evidence, "cert_info") : category === "provider_outage" ? last(evidence, "provider_status") : undefined;
  const ids = [last(evidence, "http_probe"), decisive, last(evidence, "dns_lookup")].flatMap((e) => (e ? [e.evidenceId] : []));
  const findings: Findings = {
    category,
    confidence: category === "inconclusive" ? "low" : "high",
    evidence: ids.length ? ids : [evidence[0]!.evidenceId],
    cause: `Mock diagnosis: ${CATEGORY_INFO[category]}`,
    next_steps: ["Set LLM_MODE=live for a real diagnosis."],
    actions: category === "healthy" ? [] : ["restore_demo_service"],
  };
  return completion([{ name: "submit_findings", args: JSON.stringify(findings) }]);
}

function pickCategory(evidence: EvidenceLine[]): Category {
  const dns = last(evidence, "dns_lookup");
  const http = last(evidence, "http_probe");
  if (dns && /doesn't resolve|No A or AAAA/.test(dns.summary)) return "dns_failure";
  const cert = last(evidence, "cert_info");
  const status = last(evidence, "provider_status");
  const failing = !!http && /^(HTTP 5\d\d|Connection failed|Timed out|TLS error)/.test(http.summary);
  if (cert?.status === "fail" && failing && !/^HTTP/.test(http!.summary)) return "tls_expiry";
  if (status?.status === "fail" && failing) return "provider_outage";
  if (http) {
    if (/^(Redirect loop|Too many redirects)/.test(http.summary)) return "redirect_loop";
    if (/^HTTP 5\d\d/.test(http.summary)) return "origin_5xx";
    if (/^Slow:/.test(http.summary)) return "high_latency";
    if (/"asset":\{[^}]*("cacheControl":"[^"]*(no-store|private)|"setCookie":true)/.test(http.digest)) return "cache_misconfiguration";
  }
  if (dns && /^Resolvers disagree/.test(dns.summary)) return "dns_mismatch";
  if (http && /^HTTP [23]\d\d/.test(http.summary)) return "healthy";
  return "inconclusive";
}

/** Four sections from the findings and evidence in the narration prompt, every line cited. */
function narration(user: string): string {
  const json = /^Findings: (.*)$/m.exec(user)?.[1];
  if (!json) return "Mock reply. Set LLM_MODE=live for a real answer.";
  const findings = { actions: [], ...(JSON.parse(json) as Omit<Findings, "actions">) } as Findings;
  const cites = findings.evidence.map((id) => `[${id}]`).join(" ");
  const cause = /\[[a-z]+-\d+\]/.test(findings.cause) ? findings.cause : `${findings.cause.replace(/\.$/, "")} ${cites}.`;
  const results = parseEvidence(user).map((e) => ({ ...e, ok: true, raw: null }) as ToolResult);
  return renderTemplate({ ...findings, cause }, results);
}

export function parseEvidence(text: string): EvidenceLine[] {
  return [...text.matchAll(LINE)].map((m) => ({
    evidenceId: m[1]!,
    tool: m[2] as EvidenceLine["tool"],
    status: m[3] as EvidenceLine["status"],
    summary: m[4]!,
    digest: m[5]!,
  }));
}

const last = (evidence: EvidenceLine[], tool: EvidenceLine["tool"]) => evidence.filter((e) => e.tool === tool).at(-1);

function completion(calls: { name: string; args: string }[]): ChatCompletion {
  return {
    choices: [{ message: { content: null, tool_calls: calls.map((c, i) => ({ id: `mock-call-${i}`, function: { name: c.name, arguments: c.args } })) } }],
    usage: { prompt_tokens: 0, completion_tokens: 0, neurons: 0 },
  };
}
