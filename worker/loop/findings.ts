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

/**
 * Keeps whatever the model got right when its `submit_findings` call is invalid or cut off, and fills
 * the rest from the rules (D5: "the classifier fills the fields"). A limit never throws away the model's work.
 * - No valid category → the rule findings as they are (a cause written for another category would mislead).
 * - Valid category → the model's valid fields; its evidence keeps only known IDs, and falls back to the
 *   rules' evidence if none are left; anything else invalid comes from the rules.
 */
export function salvageFindings(args: unknown, rules: Findings, knownIds: Iterable<string>): { findings: Findings; fromModel: (keyof Findings)[] } {
  const a = (args !== null && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const shape = findingsSchema.shape;
  const category = shape.category.safeParse(a.category);
  if (!category.success) return { findings: rules, fromModel: [] };

  const known = new Set(knownIds);
  const fromModel: (keyof Findings)[] = ["category"];
  const pick = <K extends Exclude<keyof Findings, "category" | "evidence">>(key: K, schema: z.ZodType<Findings[K]>): Findings[K] => {
    if (a[key] === undefined) return rules[key]; // cut off or left out: the schema's empty default would hide it
    const r = schema.safeParse(a[key]);
    if (r.success) fromModel.push(key);
    return r.success ? r.data : rules[key];
  };
  const ids = (Array.isArray(a.evidence) ? a.evidence : [])
    .map((x) => (typeof x === "string" ? EVIDENCE_ID.exec(x.trim())?.[1] : undefined))
    .filter((id): id is string => !!id && known.has(id));
  if (ids.length) fromModel.push("evidence");

  return {
    findings: {
      category: category.data,
      confidence: pick("confidence", shape.confidence),
      evidence: ids.length ? [...new Set(ids)] : rules.evidence,
      cause: pick("cause", shape.cause),
      next_steps: pick("next_steps", shape.next_steps),
      actions: pick("actions", shape.actions),
    },
    fromModel,
  };
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
