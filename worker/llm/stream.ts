import { buildInput, run, withFallback, type LlmDeps } from "./client";
import { mockStream } from "./mock";
import { LlmUnavailable, toUsage, type LlmRequest, type LlmResult, type RawUsage } from "./models";

type Chunk = {
  response?: string;
  usage?: RawUsage;
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
};

/**
 * Reads a Workers AI chat-completions SSE stream (TDD §7.4.1). Forwards only `delta.content` (never reasoning)
 * and takes usage from the final `{"response":"","usage":…}` line. Without that line, per-chunk usage is summed.
 */
export async function parseSse(
  body: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void,
): Promise<{ text: string; usage?: RawUsage; truncated: boolean }> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let text = "";
  let final: RawUsage | undefined;
  let truncated = false;
  const summed = { prompt_tokens: 0, completion_tokens: 0 };
  let done = false;

  const line = (raw: string) => {
    const l = raw.trim();
    if (!l.startsWith("data:")) return;
    const data = l.slice(5).trim();
    if (data === "[DONE]") {
      done = true;
      return;
    }
    let chunk: Chunk;
    try {
      chunk = JSON.parse(data) as Chunk;
    } catch {
      return;
    }
    if ("response" in chunk && chunk.usage) {
      final = chunk.usage;
      return;
    }
    if (chunk.usage) {
      summed.prompt_tokens = Math.max(summed.prompt_tokens, chunk.usage.prompt_tokens ?? 0);
      summed.completion_tokens += chunk.usage.completion_tokens ?? 0;
    }
    if (chunk.choices?.[0]?.finish_reason === "length") truncated = true;
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) {
      text += delta;
      onDelta(delta);
    }
  };

  while (!done) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const l of lines) {
      line(l);
      if (done) break;
    }
  }
  if (!done && buffer) line(buffer);
  await reader.cancel().catch(() => {});
  return { text, usage: final ?? (summed.completion_tokens ? summed : undefined), truncated };
}

/**
 * Streams a text answer (narration, D4). Falls back to the second model only before the first delta.
 * A stream that breaks later throws `LlmUnavailable` carrying the text already sent (`partial`), so the
 * caller keeps what the user has seen rather than dropping it.
 */
export async function streamLlm(deps: LlmDeps, req: LlmRequest, onDelta: (text: string) => void): Promise<LlmResult> {
  if (deps.mode === "mock") return mockStream(req, onDelta);
  let streamed = "";
  const forward = (t: string) => {
    streamed += t;
    onDelta(t);
  };
  try {
    return await withFallback(
      deps,
      async (model, fallback) => {
        const body = await run(deps, model, buildInput(model, req, true));
        if (!(body instanceof ReadableStream)) throw new Error("expected a stream");
        const { text, usage, truncated } = await parseSse(body as ReadableStream<Uint8Array>, forward);
        const result: LlmResult = { toolCalls: [], usage: toUsage(model, usage), model, fallback, ...(truncated ? { truncated } : {}) };
        await deps.usage.add(result.usage.neurons);
        if (!text) throw new Error("empty stream");
        return { ...result, text };
      },
      () => streamed === "",
    );
  } catch (e) {
    if (e instanceof LlmUnavailable && streamed) e.partial = streamed;
    throw e;
  }
}
