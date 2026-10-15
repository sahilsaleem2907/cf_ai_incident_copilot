import { z } from "zod";
import { BudgetExceededError, HIGH_LATENCY_TOTAL_MS, HIGH_LATENCY_TTFB_MS, HTTP_SAMPLES, SNIPPET_TO_LLM } from "../loop/budget";
import { followHops, readOnce, type HopResult, type HopStop, type Method } from "../safety/reader";
import { createGuard } from "../safety/ssrf";
import { fitDigest, untrusted } from "./digest";
import type { CheckStatus, ToolContext, ToolResult } from "./types";

/** 2 guard DoH lookups + 3 samples × (1 + 5 hops). The asset sub-probe only runs if room is left. */
export const HTTP_PROBE_CAP = 20;
const RAW_SNIPPET = 2048;
const PICKED_HEADERS = ["server", "cf-ray", "cf-cache-status", "cache-control", "content-type", "location"] as const;
const TEXTUAL = /^(text\/|application\/(json|xml|xhtml\+xml|javascript))/i;

export const httpInput = z.object({
  url: z.string().refine((u) => {
    try {
      return ["http:", "https:"].includes(new URL(u).protocol);
    } catch {
      return false;
    }
  }, "must be an http or https URL"),
  method: z.enum(["GET", "HEAD"]).default("GET"),
});
export type HttpInput = z.output<typeof httpInput>;

export type Sample = {
  status: number | null;
  ttfbMs: number | null;
  totalMs: number;
  stop: HopStop;
  error?: string;
  hops: { url: string; status: number; location: string | null }[];
};
export type AssetProbe =
  | { url: string; status: number; cacheControl: string | null; setCookie: boolean }
  | { url: string; error: string };

export type HttpRaw = {
  url: string;
  method: Method;
  samples: Sample[];
  medianTotalMs: number | null;
  medianTtfbMs: number | null;
  hops: Sample["hops"];
  headers: Partial<Record<(typeof PICKED_HEADERS)[number], string>> & { setCookie: boolean };
  snippet: string | null;
  asset: AssetProbe | null;
  refused?: { code: string; message: string };
  partial?: "rate_limited" | "budget";
};

export async function runHttpProbe(input: HttpInput, ctx: ToolContext): Promise<ToolResult<HttpRaw>> {
  const now = ctx.now ?? (() => Date.now());
  const guard = createGuard({ fetch: ctx.fetch, allowOrigin: ctx.allowOrigin });
  const host = new URL(input.url).hostname;
  const samples: Sample[] = [];
  let first: HopResult | null = null;
  let partial: HttpRaw["partial"];

  for (let i = 0; i < HTTP_SAMPLES; i++) {
    if (ctx.rateLimit && !(await ctx.rateLimit(host))) {
      partial = "rate_limited";
      break;
    }
    let result: HopResult;
    try {
      result = await followHops(ctx.fetch, guard, input.url, input.method, { now });
    } catch (e) {
      if (e instanceof BudgetExceededError || (e as Error).name === "BudgetExceededError") {
        partial = "budget";
        break;
      }
      throw e;
    }
    first ??= result;
    samples.push(toSample(result));
    // Loops, hop caps and refusals are deterministic: more samples add cost, not evidence.
    if (result.stop === "loop" || result.stop === "max_hops" || result.stop === "blocked") break;
  }

  const withResponse = samples.filter((s) => s.status !== null);
  const finalRes = first?.final ?? null;
  const headers: HttpRaw["headers"] = { setCookie: false };
  if (finalRes) {
    for (const h of PICKED_HEADERS) {
      const v = finalRes.headers.get(h);
      if (v !== null) headers[h] = v.slice(0, 200);
    }
    headers.setCookie = finalRes.headers.has("set-cookie");
  }
  const contentType = finalRes?.headers.get("content-type") ?? "";
  const textual = finalRes !== null && TEXTUAL.test(contentType) && finalRes.body.length > 0;

  let asset: AssetProbe | null = null;
  if (finalRes && first?.stop === "done" && input.method === "GET" && /html/i.test(contentType)) {
    const assetUrl = findAsset(finalRes.body, finalRes.url);
    if (assetUrl) asset = await probeAsset(ctx, guard, assetUrl, now);
  }

  const raw: HttpRaw = {
    url: input.url,
    method: input.method,
    samples,
    medianTotalMs: median(withResponse.map((s) => s.totalMs)),
    medianTtfbMs: median(withResponse.map((s) => s.ttfbMs ?? 0)),
    hops: samples[0]?.hops ?? [],
    headers,
    snippet: textual ? finalRes.body.slice(0, RAW_SNIPPET) : null,
    asset,
  };
  if (first?.stop === "blocked" && first.blocked) raw.refused = { code: first.blocked.code, message: first.blocked.message };
  if (partial) raw.partial = partial;

  const { status, summary } = judge(raw);
  return {
    evidenceId: ctx.evidenceId,
    tool: "http_probe",
    ok: status === "pass" || status === "fail",
    status,
    summary,
    digest: httpDigest(raw, textual && finalRes ? untrusted(finalRes.body, SNIPPET_TO_LLM) : null),
    raw,
  };
}

function toSample(r: HopResult): Sample {
  const hops = r.hops.map((h) => ({ url: h.url, status: h.status, location: h.location }));
  const totalMs = r.hops.reduce((sum, h) => sum + h.totalMs, 0) + (r.error && "totalMs" in r.error ? r.error.totalMs : 0);
  const last = r.hops.at(-1);
  const sample: Sample = {
    status: r.stop === "error" || r.stop === "blocked" ? null : (last?.status ?? null),
    ttfbMs: r.stop === "error" || r.stop === "blocked" ? null : (last?.ttfbMs ?? null),
    totalMs,
    stop: r.stop,
    hops,
  };
  if (r.error) sample.error = r.error.error;
  if (r.blocked) sample.error = r.blocked.code;
  return sample;
}

/** First same-origin script or stylesheet in the page (D10). */
export function findAsset(html: string, baseUrl: string): string | null {
  const base = new URL(baseUrl);
  const tags = /<script\b[^>]*?\bsrc\s*=\s*["']?([^"'\s>]+)|<link\b(?=[^>]*\brel\s*=\s*["']?stylesheet\b)[^>]*?\bhref\s*=\s*["']?([^"'\s>]+)/gi;
  for (const m of html.matchAll(tags)) {
    const href = m[1] ?? m[2];
    if (!href) continue;
    try {
      const u = new URL(href, base);
      if (u.origin === base.origin) return u.toString();
    } catch {
      // ignore malformed references
    }
  }
  return null;
}

async function probeAsset(ctx: ToolContext, guard: ReturnType<typeof createGuard>, url: string, now: () => number): Promise<AssetProbe> {
  try {
    const checked = await guard(url);
    if (!checked.ok) return { url, error: checked.code };
    const res = await readOnce(ctx.fetch, checked.url.toString(), "GET", { now });
    if (!res.ok) return { url, error: res.error };
    return { url, status: res.status, cacheControl: res.headers.get("cache-control"), setCookie: res.headers.has("set-cookie") };
  } catch (e) {
    if ((e as Error).name === "BudgetExceededError") return { url, error: "budget" };
    throw e;
  }
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

function judge(raw: HttpRaw): { status: CheckStatus; summary: string } {
  const n = raw.samples.length;
  if (n === 0) {
    return raw.partial === "rate_limited"
      ? { status: "unavailable", summary: "Probe rate limit reached for this host; try again in a minute." }
      : { status: "unavailable", summary: "Out of check budget for this run." };
  }
  if (raw.refused) {
    if (raw.refused.code === "no_addresses") return { status: "fail", summary: `DNS: ${raw.refused.message}` };
    if (raw.refused.code === "dns_error") return { status: "unavailable", summary: raw.refused.message };
    return { status: "error", summary: `Refused: ${raw.refused.message}` };
  }
  const s0 = raw.samples[0]!;
  if (s0.stop === "loop") return { status: "fail", summary: `Redirect loop after ${s0.hops.length} hops.` };
  if (s0.stop === "max_hops") return { status: "fail", summary: `Too many redirects (more than ${s0.hops.length - 1}).` };

  const errored = raw.samples.filter((s) => s.stop === "error");
  if (errored.length) {
    const kind = errored[0]!.error === "timeout" ? "Timed out" : "Connection failed";
    return { status: "fail", summary: `${kind} on ${errored.length}/${n} samples.` };
  }
  const statuses = raw.samples.map((s) => s.status ?? 0);
  const fiveXx = statuses.filter((s) => s >= 500).length;
  const redirects = Math.max(0, s0.hops.length - 1);
  const timing = `median ${raw.medianTotalMs} ms (TTFB ${raw.medianTtfbMs} ms)`;
  const tail = `${timing}${redirects ? ` · ${redirects} redirect${redirects > 1 ? "s" : ""}` : ""}`;
  if (fiveXx) return { status: "fail", summary: `HTTP ${statuses.join("/")} on ${n} samples · ${tail}` };
  if (statuses.some((s) => s >= 400)) return { status: "fail", summary: `HTTP ${statuses.join("/")} · ${tail}` };
  const slow = (raw.medianTotalMs ?? 0) >= HIGH_LATENCY_TOTAL_MS || (raw.medianTtfbMs ?? 0) >= HIGH_LATENCY_TTFB_MS;
  if (slow) return { status: "fail", summary: `Slow: ${tail}` };
  return { status: "pass", summary: `HTTP ${statuses[0]} · ${tail}` };
}

function httpDigest(raw: HttpRaw, snippet: string | null): string {
  return fitDigest(
    {
      url: raw.url,
      method: raw.method,
      samples: raw.samples.map((s) => (s.status === null ? `error:${s.error}` : `${s.status} ttfb=${s.ttfbMs} total=${s.totalMs}`)),
      medianTotalMs: raw.medianTotalMs,
      medianTtfbMs: raw.medianTtfbMs,
      stop: raw.samples[0]?.stop,
      hops: raw.hops.map((h) => `${h.status} ${h.url}${h.location ? ` -> ${h.location}` : ""}`),
      headers: raw.headers,
      asset: raw.asset,
      refused: raw.refused,
      partial: raw.partial,
      snippet,
    },
    ["snippet", "hops", "asset"],
  );
}
