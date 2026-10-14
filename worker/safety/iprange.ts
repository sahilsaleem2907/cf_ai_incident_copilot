/**
 * IP parsing and the blocked-range table for the SSRF guard (TDD §11). Anything that fails to parse
 * is treated as blocked by `isBlockedIp`.
 */

export function parseIpv4(s: string): number | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

export function parseIpv6(input: string): bigint | null {
  let s = input.toLowerCase();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  if (!s.includes(":")) return null;

  // Embedded dotted IPv4 tail, e.g. ::ffff:10.0.0.1
  if (s.includes(".")) {
    const lastColon = s.lastIndexOf(":");
    const v4 = parseIpv4(s.slice(lastColon + 1));
    if (v4 === null) return null;
    s = `${s.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  let groups: string[];
  if (halves.length === 2) {
    const tail = halves[1] ? halves[1].split(":") : [];
    if (head.length + tail.length > 7) return null;
    groups = [...head, ...Array<string>(8 - head.length - tail.length).fill("0"), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
}

type V4Range = { base: number; mask: number };
type V6Range = { base: bigint; mask: bigint };

function v4(cidr: string): V4Range {
  const [addr, len] = cidr.split("/") as [string, string];
  const bits = Number(len);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { base: (parseIpv4(addr)! & mask) >>> 0, mask };
}

function v6(cidr: string): V6Range {
  const [addr, len] = cidr.split("/") as [string, string];
  const bits = BigInt(len);
  const mask = ((1n << bits) - 1n) << (128n - bits);
  return { base: parseIpv6(addr)! & mask, mask };
}

const BLOCKED_V4 = [
  "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12",
  "192.0.0.0/24", "192.0.2.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24",
  "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4",
].map(v4);

// TDD §11 list, plus ::/96 (IPv4-compatible, covers ::/128 and ::1) and 100::/64 (discard-only).
const BLOCKED_V6 = ["::/96", "100::/64", "fc00::/7", "fe80::/10", "ff00::/8", "64:ff9b::/96", "2001:db8::/32"].map(v6);

const MAPPED_V4 = v6("::ffff:0:0/96");
const SIX_TO_FOUR = v6("2002::/16");

export function isBlockedV4(n: number): boolean {
  return BLOCKED_V4.some((r) => ((n & r.mask) >>> 0) === r.base);
}

export function isBlockedV6(n: bigint): boolean {
  if ((n & MAPPED_V4.mask) === MAPPED_V4.base) return isBlockedV4(Number(n & 0xffffffffn));
  if ((n & SIX_TO_FOUR.mask) === SIX_TO_FOUR.base) return isBlockedV4(Number((n >> 80n) & 0xffffffffn));
  return BLOCKED_V6.some((r) => (n & r.mask) === r.base);
}

/** True for private/reserved addresses and for anything that isn't a valid IP (fail closed). */
export function isBlockedIp(ip: string): boolean {
  const a = parseIpv4(ip);
  if (a !== null) return isBlockedV4(a);
  const b = parseIpv6(ip);
  if (b !== null) return isBlockedV6(b);
  return true;
}
