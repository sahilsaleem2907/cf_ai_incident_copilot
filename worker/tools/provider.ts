import { z } from "zod";
import { isSignificant, PROVIDERS, type Provider, type ProviderIncident, type ProviderRaw } from "../diagnosis/categories";
import { readOnce } from "../safety/reader";
import { fitDigest } from "./digest";
import type { CheckStatus, ToolContext, ToolResult } from "./types";

/** Fixed public status pages (D6): Statuspage's unresolved incidents for Cloudflare and GitHub, AWS's health feed. */
export const STATUS_URLS: Record<Provider, string> = {
  cloudflare: "https://www.cloudflarestatus.com/api/v2/incidents/unresolved.json",
  github: "https://www.githubstatus.com/api/v2/incidents/unresolved.json",
  aws: "https://health.aws.amazon.com/public/currentevents",
};
const NAMES: Record<Provider, string> = { cloudflare: "Cloudflare", github: "GitHub", aws: "AWS" };
/** Statuspage answers are a few KB. AWS's feed was 231 KB of UTF-16 in the WP-21 spike, so it's read in part. */
const STATUSPAGE_CAP = 64 * 1024;
const AWS_CAP = 128 * 1024;
const STATUS_TIMEOUT_MS = 5_000;
const MAX_PER_PROVIDER = 3;

export const providerInput = z.object({
  providers: z
    .array(z.enum(PROVIDERS))
    .min(1)
    .max(PROVIDERS.length)
    .transform((ps) => [...new Set(ps)]),
});
export type ProviderInput = z.output<typeof providerInput>;

/** UTF-16 with a byte-order mark (AWS sends big-endian); UTF-8 without one. */
export function decodeText(bytes: Uint8Array): string {
  const be = bytes[0] === 0xfe && bytes[1] === 0xff;
  const le = bytes[0] === 0xff && bytes[1] === 0xfe;
  if (!be && !le) return new TextDecoder().decode(bytes);
  const n = Math.floor((bytes.length - 2) / 2);
  const units = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const a = bytes[2 + 2 * i]!;
    const b = bytes[3 + 2 * i]!;
    units[i] = be ? (a << 8) | b : (b << 8) | a;
  }
  let out = "";
  for (let i = 0; i < n; i += 4096) out += String.fromCharCode(...units.subarray(i, i + 4096));
  return out;
}

const clip = (s: string, n = 120) => s.replace(/\s+/g, " ").trim().slice(0, n);

/** Statuspage `incidents/unresolved.json`. */
export function parseStatuspage(body: string): ProviderIncident[] | null {
  try {
    const j = JSON.parse(body) as { incidents?: { name?: string; status?: string; impact?: string; shortlink?: string }[] };
    if (!Array.isArray(j.incidents)) return null;
    return j.incidents.map((i) => ({
      name: clip(i.name ?? "Unnamed incident"),
      ...(i.status ? { status: i.status } : {}),
      ...(i.impact ? { impact: i.impact } : {}),
      ...(i.shortlink ? { url: i.shortlink } : {}),
    }));
  } catch {
    return null;
  }
}

type AwsEvent = { date?: string; service_name?: string; summary?: string; region_name?: string; status?: string };
/** AWS lists long-running regional events for months (two Middle East ones since March in the WP-26 recording). */
export const AWS_RECENT_MS = 24 * 3_600_000;
const AWS_EVENT = /"date"\s*:\s*"(\d*)"\s*,\s*"arn"\s*:\s*"[^"]*"\s*,\s*"region_name"\s*:\s*"([^"]*)"\s*,\s*"status"\s*:\s*"([^"]*)"\s*,\s*"service"\s*:\s*"[^"]*"\s*,\s*"service_name"\s*:\s*"([^"]*)"\s*,\s*"summary"\s*:\s*"([^"]*)"/g;

/**
 * AWS's current events, best effort. The whole feed parses when it fits the read cap; otherwise the events are
 * picked out of the part that was read (each event's first fields come before its long `event_log`).
 */
export function parseAws(body: string, truncated: boolean, now: number = Date.now()): ProviderIncident[] | null {
  // AWS gives no impact and no way to tell which region a site uses, so only events that began in the last 24 hours
  // count as an outage; older ones are listed as "ongoing" (WP-26 fix).
  const toIncident = (e: AwsEvent): ProviderIncident => {
    const began = Number(e.date) * 1000;
    const recent = !e.date || !Number.isFinite(began) || now - began <= AWS_RECENT_MS;
    return {
      name: clip(`${e.service_name ?? "AWS"}: ${e.summary ?? "event"}${e.region_name ? ` (${e.region_name})` : ""}`),
      ...(e.status ? { status: e.status } : {}),
      ...(recent ? {} : { impact: "ongoing" }),
    };
  };
  const text = body.trim();
  if (!truncated) {
    try {
      const j: unknown = JSON.parse(text);
      return Array.isArray(j) ? (j as AwsEvent[]).map(toIncident) : null;
    } catch {
      return null;
    }
  }
  if (!text.startsWith("[")) return null;
  return [...text.matchAll(AWS_EVENT)].map((m) => toIncident({ date: m[1], region_name: m[2], status: m[3], service_name: m[4], summary: m[5] }));
}

type Answer = { provider: Provider; active: ProviderIncident[] | null };

async function check(ctx: ToolContext, provider: Provider, now: () => number): Promise<Answer> {
  // (`now` times the request; the AWS feed's event ages use the same clock.)
  const aws = provider === "aws";
  const res = await readOnce(ctx.fetch, STATUS_URLS[provider], "GET", {
    readCap: aws ? AWS_CAP : STATUSPAGE_CAP,
    timeoutMs: STATUS_TIMEOUT_MS,
    now,
    ...(aws ? { decode: decodeText } : {}),
  });
  if (!res.ok || res.status !== 200) return { provider, active: null };
  return { provider, active: aws ? parseAws(res.body, res.truncated, now()) : parseStatuspage(res.body) };
}

/**
 * `provider_status` (TDD §7.3): "is it me or them?". Active incidents on each provider's public status page.
 * Only major/critical Statuspage incidents count as an outage (`isSignificant`); minor ones are listed.
 */
export async function runProviderStatus(input: ProviderInput, ctx: ToolContext): Promise<ToolResult<ProviderRaw>> {
  const now = ctx.now ?? (() => Date.now());
  const answers = await Promise.all(
    input.providers.map((p) =>
      check(ctx, p, now).catch((e: Error) => {
        if (e.name === "BudgetExceededError") throw e;
        return { provider: p, active: null };
      }),
    ),
  );
  const raw: ProviderRaw = { providers: {} };
  const unavailable: Provider[] = [];
  for (const a of answers) {
    if (a.active === null) unavailable.push(a.provider);
    else raw.providers[a.provider] = { active: a.active.slice(0, MAX_PER_PROVIDER) };
  }
  if (unavailable.length) raw.unavailable = unavailable;

  const { status, summary } = judge(raw, answers.map((a) => a.provider));
  return {
    evidenceId: ctx.evidenceId,
    tool: "provider_status",
    ok: status === "pass" || status === "fail",
    status,
    summary,
    digest: fitDigest({ providers: raw.providers, unavailable: raw.unavailable, counts: "only major/critical incidents count as an outage" }, ["counts"]),
    raw,
  };
}

function judge(raw: ProviderRaw, asked: Provider[]): { status: CheckStatus; summary: string } {
  const checked = asked.filter((p) => raw.providers[p]);
  if (checked.length === 0) return { status: "unavailable", summary: `Status pages didn't answer (${asked.map((p) => NAMES[p]).join(", ")}).` };
  const parts = checked.map((p) => {
    const active = raw.providers[p]!.active;
    const major = active.filter(isSignificant);
    if (major.length) return `${NAMES[p]}: ${major.length} active incident(s), "${major[0]!.name}"`;
    if (active.length) return `${NAMES[p]}: no outage (${active.length} minor or long-running incident(s))`;
    return `${NAMES[p]}: no active incidents`;
  });
  if (raw.unavailable?.length) parts.push(`${raw.unavailable.map((p) => NAMES[p]).join(", ")}: no answer`);
  const outage = checked.some((p) => raw.providers[p]!.active.some(isSignificant));
  return { status: outage ? "fail" : "pass", summary: `${parts.join(" · ")}.` };
}
