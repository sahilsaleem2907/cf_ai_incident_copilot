/** Models (TDD §2) and the chat-completions response mapper shared by both (TDD §7.4.1). */
export const PRIMARY = "@cf/openai/gpt-oss-120b";
export const FALLBACK = "@cf/zai-org/glm-4.7-flash";

/** Per-model request extras. glm's thinking took 12–21 s and could use up `max_tokens`, so it's always off. */
export const EXTRAS: Record<string, Record<string, unknown>> = {
  [FALLBACK]: { chat_template_kwargs: { enable_thinking: false } },
};

/** Neurons per input/output token, used only when a response doesn't report `usage.neurons`. */
export const RATES: Record<string, { in: number; out: number }> = {
  [PRIMARY]: { in: 31_818 / 1e6, out: 68_182 / 1e6 },
  [FALLBACK]: { in: 5_500 / 1e6, out: 36_400 / 1e6 },
};

export type LlmMessage = { role: "user" | "assistant"; content: string };
export type ToolDef = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };

export type LlmRequest = {
  system: string;
  messages: LlmMessage[];
  tools?: ToolDef[];
  /** Planning turns send "required": without it gpt answered in prose and skipped submit_findings (TDD §7.4.1). */
  toolChoice?: "auto" | "required";
  maxTokens: number;
};

/** No model can answer: the caller takes the rule path (TDD §8.2). */
export class LlmUnavailable extends Error {
  override name = "LlmUnavailable";
  constructor(
    readonly reason: "config" | "allocation" | "failed",
    message: string,
  ) {
    super(message);
  }
}

export type ToolCall = { id: string; name: string; args: unknown; argsError?: string };
export type Usage = { in: number; out: number; neurons: number };

export type LlmResult = {
  text?: string;
  toolCalls: ToolCall[];
  usage: Usage;
  model: string;
  /** True when the fallback model answered. */
  fallback: boolean;
};

/** The parts of a chat-completions response we read. Everything else (`reasoning*`, logprobs…) is ignored. */
export type ChatCompletion = {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string | Record<string, unknown> } }[] | null;
    };
  }[];
  usage?: RawUsage;
};
export type RawUsage = { prompt_tokens?: number; completion_tokens?: number; neurons?: number };

export function neuronsFor(model: string, usage: RawUsage | undefined): number {
  if (typeof usage?.neurons === "number") return usage.neurons;
  const rate = RATES[model] ?? RATES[PRIMARY]!;
  return (usage?.prompt_tokens ?? 0) * rate.in + (usage?.completion_tokens ?? 0) * rate.out;
}

export function toUsage(model: string, usage: RawUsage | undefined): Usage {
  return { in: usage?.prompt_tokens ?? 0, out: usage?.completion_tokens ?? 0, neurons: neuronsFor(model, usage) };
}

/**
 * Normalizes a chat-completions response. `arguments` is a JSON string; a parse failure is kept as
 * `argsError` so the planning loop can count it as an invalid call (FR-12). Prose next to tool calls is dropped.
 */
export function toResult(model: string, raw: ChatCompletion, fallback = false): LlmResult {
  const message = raw.choices?.[0]?.message ?? {};
  const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((tc, i) => {
    const id = tc.id ?? `call-${i}`;
    const name = tc.function?.name ?? "";
    const a = tc.function?.arguments;
    if (a === undefined || typeof a === "object") return { id, name, args: a ?? {} };
    try {
      return { id, name, args: JSON.parse(a) as unknown };
    } catch {
      return { id, name, args: null, argsError: `arguments are not valid JSON: ${a.slice(0, 200)}` };
    }
  });
  const text = toolCalls.length === 0 ? (message.content ?? undefined) || undefined : undefined;
  return { ...(text ? { text } : {}), toolCalls, usage: toUsage(model, raw.usage), model, fallback };
}
