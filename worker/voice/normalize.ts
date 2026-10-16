/** A hostname with an alphabetic TLD, as typed or as Whisper writes it ("Demo.Example.com"). */
const HOST = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\b/gi;
const SPOKEN_DOT = /([a-z0-9])[\s,]+dot[\s,]+(?=[a-z0-9])/gi;
const SPOKEN_SLASH = /([a-z0-9])\s+slash\s+(?=[a-z0-9])/gi;

/**
 * Cleans up a voice transcript for the input box (TDD §8.7, PRD R8): spoken "dot" and "slash" become "." and "/",
 * and hostnames are lowercased. The rest of the sentence keeps its words and case. The user still reads and sends it.
 */
export function normalizeTranscript(text: string): string {
  let t = text.replace(/\s+/g, " ").trim();
  // Twice, so "a dot b dot c" (overlapping matches) is fully joined.
  for (let i = 0; i < 2; i++) t = t.replace(SPOKEN_DOT, "$1.");
  t = t.replace(SPOKEN_SLASH, "$1/");
  return t.replace(HOST, (h) => h.toLowerCase());
}
