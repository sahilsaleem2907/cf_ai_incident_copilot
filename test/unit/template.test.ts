import { describe, expect, it } from "vitest";
import { ACTION_IDS, type Findings } from "../../worker/diagnosis/categories";
import { classify } from "../../worker/diagnosis/classify";
import { renderTemplate } from "../../worker/diagnosis/template";
import type { ToolResult } from "../../worker/tools/types";

const result = (evidenceId: string, tool: ToolResult["tool"], summary: string): ToolResult =>
  ({ evidenceId, tool, ok: true, status: "fail", summary, digest: "{}", raw: {} }) as ToolResult;

const evidence = [
  result("dns-1", "dns_lookup", "93.184.215.14 · both resolvers agree"),
  result("http-1", "http_probe", "HTTP 500/500/500 on 3 samples · median 40 ms (TTFB 30 ms)"),
  result("cert-1", "cert_info", "Expires in 60 days."),
];

const findings: Findings = {
  category: "origin_5xx",
  confidence: "high",
  evidence: ["http-1", "dns-1", "nope-9"],
  cause: "The origin returns HTTP 500 on 3/3 samples [http-1].",
  next_steps: ["Check the origin's logs.", "Roll back the last deploy."],
  actions: ["restore_demo_service"],
};

describe("renderTemplate", () => {
  const md = renderTemplate(findings, evidence);

  it("renders the four sections in order", () => {
    const at = ["**Likely cause:**", "**Evidence**", "**Confidence:** High", "**Next steps**"].map((h) => md.indexOf(h));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(md).toContain(findings.cause);
    expect(md).toContain("- Roll back the last deploy.");
  });

  it("lists one bullet per known evidence id, each ending with its [id]", () => {
    const bullets = md.split("\n").filter((l) => l.startsWith("- ") && /\[[a-z]+-\d+\]$/.test(l));
    expect(bullets).toEqual([
      "- HTTP probe: HTTP 500/500/500 on 3 samples · median 40 ms (TTFB 30 ms) [http-1]",
      "- DNS lookup: 93.184.215.14 · both resolvers agree [dns-1]",
    ]);
  });

  it("drops unknown ids and evidence the findings don't cite", () => {
    expect(md).not.toContain("nope-9");
    expect(md).not.toContain("cert-1");
  });

  it("strips a trailing period so the citation stays in the same sentence", () => {
    const md2 = renderTemplate({ ...findings, evidence: ["cert-1"] }, evidence);
    expect(md2).toContain("- Certificate: Expires in 60 days [cert-1]");
  });

  it("never mentions action ids", () => {
    for (const id of ACTION_IDS) expect(md).not.toContain(id);
  });

  it("says so when no checks completed", () => {
    expect(renderTemplate(classify([]), [])).toContain("- No checks completed.");
  });
});
