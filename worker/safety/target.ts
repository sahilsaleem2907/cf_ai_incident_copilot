/**
 * Deterministic target parser for the first chat message (D9). Order: URL, then host token, then the
 * word "demo". No safety checks here: private hosts are extracted on purpose so the SSRF guard (WP-04)
 * can refuse them with a clear message.
 */
export type TargetResult =
  | { ok: true; url: string; host: string; source: "url" | "host" | "demo" }
  | { ok: false; error: "need_target" };

const MAX_SCAN = 2000;
const SPOKEN_DOT = /([a-z0-9-])\s+dot\s+(?=[a-z0-9])/gi;
const URL_TOKEN = /\bhttps?:\/\/[^\s<>"'`]+/i;
const TRAILING_PUNCT = /[.,;:!?)\]}'"`]+$/;
// IPv4 literal | localhost | hostname with an alphabetic TLD.
const HOST_TOKEN =
  /\b((?:\d{1,3}\.){3}\d{1,3}|localhost|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})\.?(?![a-z0-9-])/gi;
const FILE_EXTENSIONS = new Set([
  "html", "htm", "js", "mjs", "cjs", "json", "css", "php", "txt", "md", "ts", "tsx", "jsx",
  "png", "jpg", "jpeg", "gif", "svg", "ico", "yaml", "yml", "log", "xml", "csv", "sh", "py",
]);
const DEMO_WORD = /\bdemo\b/i;

export function parseTarget(message: string, demoUrl: string): TargetResult {
  const text = message.slice(0, MAX_SCAN).replace(SPOKEN_DOT, "$1.");

  const url = fromUrlToken(text);
  if (url) return url;

  const host = fromHostToken(text);
  if (host) return host;

  if (DEMO_WORD.test(text)) {
    return { ok: true, url: demoUrl, host: new URL(demoUrl).hostname, source: "demo" };
  }
  return { ok: false, error: "need_target" };
}

function fromUrlToken(text: string): TargetResult | null {
  const match = URL_TOKEN.exec(text);
  if (!match) return null;
  try {
    const u = new URL(match[0].replace(TRAILING_PUNCT, ""));
    u.username = "";
    u.password = "";
    u.hash = "";
    return { ok: true, url: u.toString(), host: u.hostname, source: "url" };
  } catch {
    return null;
  }
}

function fromHostToken(text: string): TargetResult | null {
  for (const match of text.matchAll(HOST_TOKEN)) {
    const host = match[1]!.toLowerCase();
    if (isIpv4Shaped(host)) {
      if (!host.split(".").every((o) => Number(o) <= 255)) continue;
    } else if (host !== "localhost" && FILE_EXTENSIONS.has(host.slice(host.lastIndexOf(".") + 1))) {
      continue;
    }
    return { ok: true, url: `https://${host}/`, host, source: "host" };
  }
  return null;
}

function isIpv4Shaped(host: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);
}
