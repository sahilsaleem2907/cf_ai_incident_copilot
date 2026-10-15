import { z } from "zod";
import { countingFetch, SubrequestCounter } from "../loop/budget";
import { assertInScope, OutOfScopeError, type Scope } from "../safety/origin";
import { dnsInput, runDnsLookup } from "./dns";
import { HTTP_PROBE_CAP, httpInput, runHttpProbe } from "./http";
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
    parameters: () => {
      const schema = z.toJSONSchema(def.input, { io: "input" }) as Record<string, unknown>;
      delete schema.$schema;
      return schema;
    },
    prepare: (args) => {
      const parsed = def.input.safeParse(args);
      if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
      const input = parsed.data;
      return { ok: true, args: input, cap: def.maxSubrequests(input), run: (ctx) => def.run(input, ctx) };
    },
  };
}

export const TOOLS: Partial<Record<ToolName, RegisteredTool>> = {
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
};

/** OpenAI chat-completions tool definitions (TDD §7.4.1); WP-07 appends `submit_findings`. */
export function llmTools() {
  return Object.values(TOOLS).map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters() },
  }));
}

export type RunOutcome = { ok: true; result: ToolResult; subrequests: number; cap: number } | { ok: false; invalid: string };

/**
 * Validates args (zod), enforces the origin pin (D6) and runs the tool under its subrequest cap.
 * Invalid or out-of-scope calls come back as `invalid` so the loop can report them to the model (FR-12).
 */
export async function runTool(name: string, args: unknown, ctx: ToolContext, scope: Scope): Promise<RunOutcome> {
  const tool = TOOLS[name as ToolName];
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
