import { LLM_TIMEOUT_MS } from "../loop/budget";
import { mockCall } from "./mock";
import { EXTRAS, FALLBACK, LlmUnavailable, PRIMARY, toResult, type ChatCompletion, type LlmRequest, type LlmResult } from "./models";
import { d1Usage, type UsageSink } from "./usage";

/** The slice of `env.AI` we use. Typed loosely: the generated model types don't cover the chat-completions input. */
export type AiRunner = { run(model: string, input: Record<string, unknown>, options: Record<string, unknown>): Promise<unknown> };

export type LlmDeps = {
  ai: AiRunner;
  gatewayId: string;
  mode: "live" | "mock";
  usage: UsageSink;
  timeoutMs?: number;
  models?: { primary: string; fallback: string };
};

export function llmDeps(env: Pick<Env, "AI" | "AI_GATEWAY_ID" | "LLM_MODE" | "DB">): LlmDeps {
  return {
    ai: env.AI as unknown as AiRunner,
    gatewayId: env.AI_GATEWAY_ID,
    mode: env.LLM_MODE === "mock" ? "mock" : "live",
    usage: d1Usage(env.DB),
  };
}

/** Chat-completions input for one model (TDD §7.4.1). */
export function buildInput(model: string, req: LlmRequest, stream: boolean): Record<string, unknown> {
  return {
    messages: [{ role: "system", content: req.system }, ...req.messages],
    ...(req.tools?.length ? { tools: req.tools, ...(req.toolChoice ? { tool_choice: req.toolChoice } : {}) } : {}),
    max_tokens: req.maxTokens,
    ...(stream ? { stream: true } : {}),
    ...EXTRAS[model],
  };
}

/** One normalized, non-streaming call: primary, then fallback (TDD §7.4). Throws `LlmUnavailable`. */
export async function callLlm(deps: LlmDeps, req: LlmRequest): Promise<LlmResult> {
  if (deps.mode === "mock") return mockCall(req);
  return withFallback(deps, async (model, fallback) => {
    const raw = await run(deps, model, buildInput(model, req, false));
    const result = toResult(model, raw as ChatCompletion, fallback);
    await deps.usage.add(result.usage.neurons);
    if (!result.text && result.toolCalls.length === 0) throw new Error("empty response: no text and no tool calls");
    return result;
  });
}

export function run(deps: LlmDeps, model: string, input: Record<string, unknown>): Promise<unknown> {
  const ms = deps.timeoutMs ?? LLM_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout: no response from ${model} after ${ms} ms`)), ms);
  });
  return Promise.race([deps.ai.run(model, input, { gateway: { id: deps.gatewayId } }), timeout]).finally(() => clearTimeout(timer));
}

type Failure = "config" | "allocation" | "retry";

/** An error's message, or the thrown value as text when it isn't an Error. */
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Workers AI errors carry a numeric code at the start of the message (`2001: …`, `5007: …`).
 * 2001 (gateway not configured) fails the same way for both models, and both share one neuron allocation,
 * so neither is worth a fallback call.
 */
export function failureKind(e: unknown): Failure {
  const message = errText(e);
  if (/^2001\b/.test(message)) return "config";
  if (/allocation|daily (free )?(limit|neurons)|quota exceeded/i.test(message)) return "allocation";
  return "retry";
}

/**
 * Runs `attempt` on the primary model, then once on the fallback for retryable errors.
 * `canRetry` lets streaming refuse a fallback once deltas have been sent.
 */
export async function withFallback<T>(
  deps: LlmDeps,
  attempt: (model: string, fallback: boolean) => Promise<T>,
  canRetry: () => boolean = () => true,
): Promise<T> {
  const { primary, fallback } = deps.models ?? { primary: PRIMARY, fallback: FALLBACK };
  const fail = async (e: unknown, model: string): Promise<LlmUnavailable | null> => {
    const kind = failureKind(e);
    const message = `${model}: ${errText(e)}`;
    if (kind === "config") {
      console.error("llm config error", message);
      return new LlmUnavailable("config", message);
    }
    if (kind === "allocation") {
      await deps.usage.exhausted();
      return new LlmUnavailable("allocation", message);
    }
    console.warn("llm call failed", message);
    return null;
  };

  try {
    return await attempt(primary, false);
  } catch (e) {
    const fatal = await fail(e, primary);
    if (fatal) throw fatal;
    if (!canRetry()) throw new LlmUnavailable("failed", `${primary}: ${errText(e)}`);
  }
  try {
    return await attempt(fallback, true);
  } catch (e) {
    throw (await fail(e, fallback)) ?? new LlmUnavailable("failed", `${fallback}: ${errText(e)}`);
  }
}
