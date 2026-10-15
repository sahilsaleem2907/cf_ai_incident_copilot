import { describe, expect, it } from "vitest";
import { classify } from "../../worker/diagnosis/classify";
import { renderTemplate } from "../../worker/diagnosis/template";
import { checkCitations, isWellFormedNarration } from "../../worker/llm/citations";
import type { ToolResult } from "../../worker/tools/types";

const known = ["http-1", "dns-1"];

describe("checkCitations", () => {
  it("keeps cited factual sentences and uncited prose", () => {
    const text = "The origin returns HTTP 500 on 3/3 samples [http-1]. That usually means the app is crashing.";
    expect(checkCitations(text, known)).toEqual({ text, removed: 0 });
  });

  it("removes uncited factual sentences and says how many", () => {
    const r = checkCitations("The origin returns HTTP 500 [http-1]. Median latency was 3000 ms. It looks broken.", known);
    expect(r.removed).toBe(1);
    expect(r.text).toBe("The origin returns HTTP 500 [http-1]. It looks broken.\n\n_1 uncited statement removed_");
  });

  it("removes references to unknown IDs, and the sentence if nothing valid is left", () => {
    const r = checkCitations("DNS returns NXDOMAIN [dns-9]. The probe saw HTTP 200 [http-1] [cert-4].", known);
    expect(r.text).toBe("The probe saw HTTP 200 [http-1].\n\n_1 uncited statement removed_");
  });

  it("treats a bullet as one unit", () => {
    const r = checkCitations("**Evidence**\n- HTTP 500/500/500 on 3 samples [http-1]\n- TTFB 2400 ms\n- Looks bad", known);
    expect(r.text).toBe("**Evidence**\n- HTTP 500/500/500 on 3 samples [http-1]\n- Looks bad\n\n_1 uncited statement removed_");
  });

  it("keeps bold labels even when their sentence goes", () => {
    const r = checkCitations("**Likely cause:** The server returned 502.\n**Confidence:** High", known);
    expect(r.text).toBe("**Likely cause:**\n**Confidence:** High\n\n_1 uncited statement removed_");
  });

  it("keeps a citation written after the full stop with its sentence", () => {
    const r = checkCitations("Both resolvers return NXDOMAIN. [dns-1] Fix the zone.", known);
    expect(r).toMatchObject({ removed: 0, text: "Both resolvers return NXDOMAIN. [dns-1] Fix the zone." });
  });

  it("counts record types and header names as factual, but not the article 'A'", () => {
    expect(checkCitations("There is no AAAA record.", known).removed).toBe(1);
    expect(checkCitations("The asset sends cache-control no-store.", known).removed).toBe(1);
    expect(checkCitations("A redirect rule is probably wrong.", known).removed).toBe(0);
  });

  it("accepts gpt's full-width citation brackets", () => {
    expect(checkCitations("HTTP 503 on all three samples【http-1】.", known)).toEqual({ text: "HTTP 503 on all three samples[http-1].", removed: 0 });
  });

  it("recognizes a usable narration and rejects junk", () => {
    expect(isWellFormedNarration("**Likely cause:** The origin fails 【http-1】.", known)).toBe(true);
    expect(isWellFormedNarration("!".repeat(500), known)).toBe(false);
    expect(isWellFormedNarration("**Likely cause:** Something [cert-9].", known)).toBe(false);
  });

  it("pluralizes the note", () => {
    expect(checkCitations("Took 3 s. Took 4 s.", known).text).toBe("_2 uncited statements removed_");
  });

  it("leaves the rule template's cause and evidence intact", () => {
    const results = [
      { evidenceId: "dns-1", tool: "dns_lookup", ok: true, status: "pass", summary: "93.184.215.14 · both resolvers agree", digest: "{}", raw: { hostname: "x", types: ["A"], resolvers: { cloudflare: { A: { status: "NOERROR", answers: [{ type: "A", data: "93.184.215.14", ttl: 60 }] } }, google: { A: { status: "NOERROR", answers: [{ type: "A", data: "93.184.215.14", ttl: 60 }] } } }, addresses: { cloudflare: ["93.184.215.14"], google: ["93.184.215.14"] }, cnameChain: [], cnameTargets: [], mismatch: false, addressesDiffer: false, ssrfBlocked: false } },
      { evidenceId: "http-1", tool: "http_probe", ok: true, status: "fail", summary: "HTTP 500/500/500 on 3 samples · median 40 ms (TTFB 30 ms)", digest: "{}", raw: { url: "https://shop.example.com/", method: "GET", samples: [500, 500, 500].map((status) => ({ status, ttfbMs: 30, totalMs: 40, stop: "done", hops: [] })), medianTotalMs: 40, medianTtfbMs: 30, hops: [], headers: { setCookie: false }, snippet: null, asset: null } },
    ] as ToolResult[];
    const findings = classify(results);
    const md = renderTemplate(findings, results);
    const head = md.slice(0, md.indexOf("**Confidence:**"));
    expect(checkCitations(head, known)).toMatchObject({ removed: 0 });
  });
});
