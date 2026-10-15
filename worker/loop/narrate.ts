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
}): NarrationOutcome {
  const cut = p.truncated || (!p.text && !!p.partial);
  const candidate = p.text ?? p.partial;
  if (!candidate || !isWellFormedNarration(candidate, p.knownIds)) return { text: p.template(), source: "template" };
  const checked = checkCitations(candidate, p.knownIds).text;
  return cut ? { text: `${checked}\n\n${CUT_SHORT_NOTE}`, source: "partial" } : { text: checked, source: "llm" };
}
