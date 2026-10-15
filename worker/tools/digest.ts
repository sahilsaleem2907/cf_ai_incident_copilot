export const DIGEST_MAX = 1536;

const encoder = new TextEncoder();
const byteLength = (s: string) => encoder.encode(s).length;

/**
 * Serialises `obj` as compact JSON, dropping keys in `dropOrder` until it fits in `max` bytes.
 * As a last resort the string is cut, so the bound always holds.
 */
export function fitDigest(obj: Record<string, unknown>, dropOrder: readonly string[], max = DIGEST_MAX): string {
  const copy: Record<string, unknown> = { ...obj };
  let out = JSON.stringify(copy);
  for (const key of dropOrder) {
    if (byteLength(out) <= max) return out;
    delete copy[key];
    out = JSON.stringify(copy);
  }
  while (byteLength(out) > max) out = `${out.slice(0, Math.max(0, out.length - 64))}…`;
  return out;
}

/**
 * Text from the internet, prepared for a prompt: tags stripped, whitespace collapsed, cut to `max`
 * characters and wrapped so the model treats it as data (TDD §9.1). Nested markers are escaped.
 */
export function untrusted(text: string, max = 500): string {
  const plain = text
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .replace(/<\/?untrusted/gi, (m) => m.replace("<", "&lt;"));
  return `<untrusted>${plain}</untrusted>`;
}
