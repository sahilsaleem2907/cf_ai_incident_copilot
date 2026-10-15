import { checkCitations, isWellFormedNarration } from "../llm/citations";

export const CUT_SHORT_NOTE = "_Narration was cut short._";
/** Narrations in the live check used about 400 output tokens; leave headroom so they aren't cut off. */
export const NARRATION_MAX_TOKENS = 900;

export type NarrationOutcome = { text: string; source: "llm" | "partial" | "template" };

/**
 * Picks what to store after a narration attempt (D4, TDD §8.2 "Limits keep progress"):
 * - a complete, well-formed answer → citation-checked text;
 * - a cut-off answer (`truncated`, or `partial` text from a broken stream) that is well formed →
 *   kept with a note, so text the user already saw isn't replaced;
 * - anything else (junk, nothing) → the rule template.
 */
export function finalizeNarration(p: {
  text?: string;
  partial?: string;
  truncated?: boolean;
  knownIds: readonly string[];
  template: () => string;
  /** The findings' cause with its evidence IDs, for a "Likely cause" the citation check emptied. */
  cause?: { text: string; evidence: readonly string[] };
}): NarrationOutcome {
  const cut = p.truncated || (!p.text && !!p.partial);
  const candidate = p.text ?? p.partial;
  if (!candidate || !isWellFormedNarration(candidate, p.knownIds)) return { text: p.template(), source: "template" };
  const checked = fillEmptyCause(checkCitations(candidate, p.knownIds).text, p.cause, p.knownIds);
  return cut ? { text: `${checked}\n\n${CUT_SHORT_NOTE}`, source: "partial" } : { text: checked, source: "llm" };
}

const CAUSE_LABEL = /^(\s*(?:\d+\.\s*)?\*\*Likely cause:?\*\*:?)\s*$/i;
const REF = /\[[a-z]+-\d+\]/;

/**
 * WP-13b (live): the model put the cause on its own line without a citation, the citation check removed it,
 * and "**Likely cause:**" was left empty. The findings' own cause (with its evidence IDs) goes back in.
 */
export function fillEmptyCause(text: string, cause: { text: string; evidence: readonly string[] } | undefined, knownIds: readonly string[]): string {
  if (!cause?.text.trim()) return text;
  const lines = text.split("\n");
  const i = lines.findIndex((l) => CAUSE_LABEL.test(l));
  if (i < 0) return text;
  const next = lines.slice(i + 1).find((l) => l.trim());
  // Not empty if a plain line follows: the cause is written under the label.
  if (next !== undefined && !/^\s*(?:\d+\.\s*)?\*\*/.test(next) && !/^_\d+ uncited/.test(next)) return text;
  const known = new Set(knownIds);
  const ids = cause.evidence.filter((id) => known.has(id));
  const body = REF.test(cause.text) || ids.length === 0 ? cause.text.trim() : `${cause.text.trim().replace(/\.$/, "")} ${ids.map((id) => `[${id}]`).join(" ")}.`;
  lines[i] = `${CAUSE_LABEL.exec(lines[i]!)![1]} ${body}`;
  return lines.join("\n");
}
