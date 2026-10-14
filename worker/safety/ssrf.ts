import { dohQuery, RESOLVERS, RR_TYPES, type Fetch } from "../lib/doh";
import { isBlockedIp, parseIpv4 } from "./iprange";

/**
 * SSRF guard (TDD §11). Shape checks need no network; `createGuard` adds the DoH check of every
 * A/AAAA answer and caches it per host for the lifetime of one tool call.
 */
export type SsrfCode =
  | "invalid_url"
  | "scheme"
  | "port"
  | "credentials"
  | "ip_literal"
  | "local_name"
  | "private_address"
  | "no_addresses"
  | "dns_error";

export type GuardOk = { ok: true; url: URL; devAllowed?: true };
export type GuardFail = { ok: false; code: SsrfCode; message: string };
export type GuardResult = GuardOk | GuardFail;
export type Guard = (url: string) => Promise<GuardResult>;

const ALLOWED_PORTS = new Set(["", "80", "443"]);

function fail(code: SsrfCode, message: string): GuardFail {
  return { ok: false, code, message };
}

/** Reads the dev-only exception without adding it to the generated `Env` (it only exists in `.dev.vars`). */
export function devAllowOrigin(env: object): string | undefined {
  const value = (env as { SSRF_DEV_ALLOW_ORIGIN?: unknown }).SSRF_DEV_ALLOW_ORIGIN;
  return typeof value === "string" && value !== "" ? value : undefined;
}

function sameOrigin(url: URL, allowed: string | undefined): boolean {
  if (!allowed) return false;
  try {
    return url.origin === new URL(allowed).origin;
  } catch {
    return false;
  }
}

export function checkUrlShape(raw: string, allowOrigin?: string): GuardResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail("invalid_url", "That isn't a valid URL.");
  }
  if (sameOrigin(url, allowOrigin)) return { ok: true, url, devAllowed: true };

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return fail("scheme", `Only http and https are allowed, not ${url.protocol.replace(":", "")}.`);
  }
  if (!ALLOWED_PORTS.has(url.port)) return fail("port", `Only ports 80 and 443 are allowed, not ${url.port}.`);
  if (url.username || url.password) return fail("credentials", "URLs with credentials aren't allowed.");

  const host = url.hostname.replace(/\.$/, "");
  if (host.startsWith("[") || parseIpv4(host) !== null) {
    const kind = isBlockedIp(host) ? "a private or reserved address" : "an IP address";
    return fail("ip_literal", `${host} is ${kind}. Give a public hostname instead.`);
  }
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    !host.includes(".")
  ) {
    return fail("local_name", `${host} is a local or internal name, not a public hostname.`);
  }
  return { ok: true, url };
}

/** Resolves A and AAAA over DoH and refuses the host if any answer is private or reserved. */
export async function resolveAndCheck(fetchFn: Fetch, host: string): Promise<GuardResult | null> {
  let addresses: string[];
  try {
    const results = await Promise.all([
      dohQuery(fetchFn, RESOLVERS.cloudflare, host, "A"),
      dohQuery(fetchFn, RESOLVERS.cloudflare, host, "AAAA"),
    ]);
    addresses = results
      .flatMap((r) => r.answers)
      .filter((a) => a.type === RR_TYPES.A || a.type === RR_TYPES.AAAA)
      .map((a) => a.data);
  } catch (e) {
    if ((e as Error).name === "BudgetExceededError") throw e;
    return fail("dns_error", `Couldn't resolve ${host} safely: ${(e as Error).message}`);
  }
  if (addresses.length === 0) return fail("no_addresses", `${host} has no A or AAAA records.`);
  const blocked = addresses.find((ip) => isBlockedIp(ip));
  if (blocked) return fail("private_address", `${host} resolves to ${blocked}, a private or reserved address.`);
  return null;
}

/** Guard for one tool call: shape check, then a cached DoH check per host. Use it on every hop. */
export function createGuard(deps: { fetch: Fetch; allowOrigin?: string }): Guard {
  const byHost = new Map<string, Promise<GuardResult | null>>();
  return async (raw) => {
    const shape = checkUrlShape(raw, deps.allowOrigin);
    if (!shape.ok || shape.devAllowed) return shape;
    const host = shape.url.hostname.replace(/\.$/, "");
    let pending = byHost.get(host);
    if (!pending) {
      pending = resolveAndCheck(deps.fetch, host);
      byHost.set(host, pending);
    }
    return (await pending) ?? shape;
  };
}
