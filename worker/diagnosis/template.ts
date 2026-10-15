import { toolLabel } from "../tools/registry";
import type { ToolResult } from "../tools/types";
import type { Confidence, Findings } from "./categories";
import { trimDot } from "./classify";

const CONFIDENCE: Record<Confidence, string> = { high: "High", medium: "Medium", low: "Low" };

/**
 * The four-section diagnosis (TDD §9.1) without an LLM: used by the rule path and as the narrate fallback.
 * Every evidence bullet ends with its `[id]`, and action IDs are never mentioned (the approval card shows them).
 */
export function renderTemplate(findings: Findings, results: ToolResult[]): string {
  const byId = new Map(results.map((r) => [r.evidenceId, r]));
  const bullets = findings.evidence.flatMap((id) => {
    const r = byId.get(id);
    return r ? [`- ${toolLabel(r.tool)}: ${trimDot(r.summary)} [${id}]`] : [];
  });
  return [
    `**Likely cause:** ${findings.cause}`,
    ["**Evidence**", ...(bullets.length ? bullets : ["- No checks completed."])].join("\n"),
    `**Confidence:** ${CONFIDENCE[findings.confidence]}`,
    ["**Next steps**", ...findings.next_steps.map((s) => `- ${s}`)].join("\n"),
  ].join("\n\n");
}
