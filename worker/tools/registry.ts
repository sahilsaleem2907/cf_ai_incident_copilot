import { z } from "zod";
import { toolParameters } from "../lib/schema";
import { countingFetch, SubrequestCounter } from "../loop/budget";
import { submitFindingsTool } from "../loop/findings";
import { assertInScope, OutOfScopeError, type Scope } from "../safety/origin";
import { certInput, certQueries, runCertInfo } from "./cert";
import { dnsInput, runDnsLookup } from "./dns";
import { HTTP_PROBE_CAP, httpInput, runHttpProbe } from "./http";
import { providerInput, runProviderStatus } from "./provider";
import type { ToolContext, ToolName, ToolResult } from "./types";

/** Evidence ID prefixes (TDD §6.4); the incident's agent allocates `n` (WP-08). */
export const EVIDENCE_PREFIX: Record<ToolName, string> = {
  dns_lookup: "dns",
  http_probe: "http",
  cert_info: "cert",
  provider_status: "status",
};

export function evidenceId(tool: ToolName, n: number): string {
  return `${EVIDENCE_PREFIX[tool]}-${n}`;
}

/** Display name for a check. */
export function toolLabel(tool: ToolName): string {
  return TOOLS[tool].label;
}

type ToolDef<S extends z.ZodType> = {
  name: ToolName;
  label: string;
  description: string;
  input: S;
  maxSubrequests: (input: z.output<S>) => number;
  run: (input: z.output<S>, ctx: ToolContext) => Promise<ToolResult>;
};

type Prepared = { ok: true; args: unknown; cap: number; run: (ctx: ToolContext) => Promise<ToolResult> } | { ok: false; error: string };

export type RegisteredTool = {
  name: ToolName;
  label: string;
  description: string;
  parameters: () => Record<string, unknown>;
  prepare: (args: unknown) => Prepared;
};

function register<S extends z.ZodType>(def: ToolDef<S>): RegisteredTool {
  return {
    name: def.name,
    label: def.label,
    description: def.description,
    parameters: () => toolParameters(def.input),
    prepare: (args) => {
      const parsed = def.input.safeParse(args);
      if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
      const input = parsed.data;
      return { ok: true, args: input, cap: def.maxSubrequests(input), run: (ctx) => def.run(input, ctx) };
    },
  };
}

export const TOOLS: Record<ToolName, RegisteredTool> = {
  dns_lookup: register({
    name: "dns_lookup",
    label: "DNS lookup",
    description:
      "Resolve DNS records for the incident host (or a CNAME target from earlier DNS evidence) via Cloudflare and Google DNS-over-HTTPS. Reports status, answers, TTLs, the CNAME chain and whether the resolvers disagree.",
    input: dnsInput,
    maxSubrequests: (i) => 2 * i.types.length,
    run: runDnsLookup,
  }),
  http_probe: register({
    name: "http_probe",
    label: "HTTP probe",
    description:
      "Request a URL on the incident host 3 times. Reports status codes, time to first byte and total time, redirect hops, selected headers, an untrusted body snippet and the cache headers of one same-origin asset.",
    input: httpInput,
    maxSubrequests: () => HTTP_PROBE_CAP,
    run: runHttpProbe,
  }),
  cert_info: register({
    name: "cert_info",
    label: "Certificate",
    description:
      "Look up unexpired TLS certificates for the incident host (or a CNAME target) in certificate-transparency logs (crt.sh). Best effort: it shows certificates that were issued, not necessarily the one being served, and is often slow. Use it when HTTPS connections fail.",
    input: certInput,
    maxSubrequests: (i) => certQueries(i.hostname).length,
    run: runCertInfo,
  }),
  provider_status: register({
    name: "provider_status",
    label: "Provider status",
    description:
      "Check the public status pages of hosting providers (cloudflare, github, aws) for active incidents, to tell whether a failure is the site's or its provider's. Only call it when the site is failing; a healthy site needs no status check. Only major or critical incidents count as an outage.",
    input: providerInput,
    maxSubrequests: (i) => i.providers.length,
    run: runProviderStatus,
  }),
};

/**
 * OpenAI chat-completions tool definitions for planning turns (TDD §7.4.1), ending with `submit_findings` (D5).
 * `finishOnly` offers just `submit_findings` for the last turn: with `tool_choice: "required"` the model must
 * finish (live check: glm ignored "call submit_findings now" and asked for more probes).
 */
export function llmTools({ finishOnly = false } = {}) {
  if (finishOnly) return [submitFindingsTool()];
  return [
    ...Object.values(TOOLS).map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.parameters() },
    })),
    submitFindingsTool(),
  ];
}

export type RunOutcome = { ok: true; result: ToolResult; subrequests: number; cap: number } | { ok: false; invalid: string };

/**
 * Validates args (zod), enforces the origin pin (D6) and runs the tool under its subrequest cap.
 * Invalid or out-of-scope calls come back as `invalid` so the loop can report them to the model (FR-12).
 */
export async function runTool(name: string, args: unknown, ctx: ToolContext, scope: Scope): Promise<RunOutcome> {
  const tool = Object.hasOwn(TOOLS, name) ? TOOLS[name as ToolName] : undefined;
  if (!tool) return { ok: false, invalid: `Unknown tool ${name}.` };
  const prepared = tool.prepare(args);
  if (!prepared.ok) return { ok: false, invalid: `Invalid arguments for ${name}: ${prepared.error}` };
  try {
    assertInScope(name, prepared.args, scope);
  } catch (e) {
    if (e instanceof OutOfScopeError) return { ok: false, invalid: e.message };
    throw e;
  }
  const counter = new SubrequestCounter(prepared.cap);
  const result = await prepared.run({ ...ctx, fetch: countingFetch(ctx.fetch, counter) });
  return { ok: true, result, subrequests: counter.count, cap: prepared.cap };
}
