import { z } from "zod";
import { toolParameters } from "../lib/schema";
import { ACTION_IDS, CATEGORIES, CONFIDENCES, type Findings } from "../diagnosis/categories";

/** `dns-1` or `[dns-1]`. Both models put whole sentences here in the spike (TDD §7.4.1); those are rejected. */
const EVIDENCE_ID = /^\[?([a-z]+-\d+)\]?$/;

export const findingsSchema = z.object({
  category: z.enum(CATEGORIES),
  confidence: z.enum(CONFIDENCES),
  evidence: z
    .array(z.string().trim().regex(EVIDENCE_ID, "must be an evidence ID like dns-1, not a sentence"))
    .min(1)
    .max(10)
    .describe("Evidence IDs only, e.g. [\"http-1\", \"dns-1\"]. No sentences.")
    .transform((ids) => [...new Set(ids.map((id) => EVIDENCE_ID.exec(id)![1]!))]),
  cause: z.string().trim().min(1).max(300).describe("The likely cause in one or two sentences."),
  next_steps: z.array(z.string().trim().min(1).max(200)).max(4).default([]),
  actions: z.array(z.enum(ACTION_IDS)).max(1).default([]).describe("At most one action ID from the catalog, or none."),
});

export const SUBMIT_FINDINGS = "submit_findings";

export type ParsedFindings = { ok: true; findings: Findings } | { ok: false; error: string };

/** Validates `submit_findings` arguments (D5). */
export function parseFindings(args: unknown): ParsedFindings {
  const parsed = findingsSchema.safeParse(args);
  if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
  const findings: Findings = parsed.data;
  return { ok: true, findings };
}

/** OpenAI chat-completions tool definition; ends planning (D5). */
export function submitFindingsTool() {
  const parameters = toolParameters(findingsSchema);
  return {
    type: "function" as const,
    function: {
      name: SUBMIT_FINDINGS,
      description:
        "Finish the investigation with a structured diagnosis. Call this exactly once, when the evidence is enough or the budget is spent.",
      parameters,
    },
  };
}
