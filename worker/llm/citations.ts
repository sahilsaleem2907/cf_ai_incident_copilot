const REF = /\[([a-z]+-\d+)\]/g;
const LEADING_REFS = /^((?:\[[a-z]+-\d+\][\s.,;]*)+)/;
const BULLET = /^\s*(?:[-*•]|\d+\.)\s+/;
/** A bold label at the start of a line: `**Likely cause:**`, `2. **Evidence**`. */
const LABEL = /^(\s*(?:\d+\.\s*)?\*\*[^*]+\*\*:?)\s*/;
/** Digits, timings, record types and header names make a statement factual (TDD §9.2). */
const FACTUAL_CI = /\d|\bms\b|\b(ttl|ttfb)\b|cache-control|set-cookie|cf-ray|cf-cache-status|content-type|\bserver:|\blocation:/i;
const FACTUAL_CS = /\b(AAAA|CNAME|MX|TXT|NS|NXDOMAIN|SERVFAIL|NOERROR)\b/;

const isFactual = (s: string) => FACTUAL_CI.test(s) || FACTUAL_CS.test(s);

/**
 * Post-check for narration (TDD §9.2): references to unknown IDs are removed, and so is any factual
 * sentence or bullet left without a valid `[id]`. Nothing is repaired with another LLM turn.
 */
export function checkCitations(text: string, knownIds: Iterable<string>): { text: string; removed: number } {
  const known = new Set(knownIds);
  text = normalizeRefs(text);
  let removed = 0;

  const clean = (s: string) =>
    s
      .replace(REF, (m, id: string) => (known.has(id) ? m : ""))
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\s+([.,;:])/g, "$1")
      .trim();
  const cited = (s: string) => [...s.matchAll(REF)].some((m) => known.has(m[1]!));
  /** Keeps a unit only if it isn't an uncited factual statement. */
  const keep = (unit: string) => {
    const c = clean(unit);
    if (c && isFactual(c) && !cited(c)) {
      removed++;
      return null;
    }
    return c;
  };

  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      out.push(line);
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      const kept = keep(line.slice(bullet[0].length));
      if (kept) out.push(`${bullet[0]}${kept}`);
      continue;
    }
    const label = LABEL.exec(line);
    const prefix = label ? label[1]! : "";
    const body = label ? line.slice(label[0].length) : line;
    const sentences = joinTrailingRefs(body.split(/(?<=[.!?])\s+/));
    const kept = sentences.map(keep).filter((s): s is string => !!s);
    if (prefix || kept.length) out.push([prefix, kept.join(" ")].filter(Boolean).join(" "));
  }

  const note = removed ? `_${removed} uncited statement${removed === 1 ? "" : "s"} removed_` : "";
  const body = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text: [body, note].filter(Boolean).join("\n\n"), removed };
}

/** gpt-oss cites with full-width brackets (`【dns-1】`) in streamed text (WP-07 live check). */
export const normalizeRefs = (text: string) => text.replace(/【\s*([a-z]+-\d+)\s*】/g, "[$1]");

/**
 * Whether a narration is usable at all: it has the "Likely cause" label and cites a known ID.
 * The live check once streamed a single run of "!!!…"; the caller then uses the rule template instead.
 */
export function isWellFormedNarration(text: string, knownIds: Iterable<string>): boolean {
  const known = new Set(knownIds);
  const t = normalizeRefs(text);
  return /\*\*Likely cause:?\*\*/i.test(t) && [...t.matchAll(REF)].some((m) => known.has(m[1]!));
}

/** "Fact. [http-1] Next." keeps the citation with the sentence before it. */
function joinTrailingRefs(parts: string[]): string[] {
  const out: string[] = [];
  for (const part of parts) {
    const m = LEADING_REFS.exec(part);
    if (m && out.length) {
      out[out.length - 1] = `${out[out.length - 1]} ${m[1]!.trim()}`;
      const rest = part.slice(m[0].length).trim();
      if (rest) out.push(rest);
    } else if (part.trim()) {
      out.push(part);
    }
  }
  return out;
}
