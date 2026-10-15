import { buildInput, run, withFallback, type LlmDeps } from "./client";
import { mockStream } from "./mock";
import { toUsage, type LlmRequest, type LlmResult, type RawUsage } from "./models";

type Chunk = {
  response?: string;
  usage?: RawUsage;
  choices?: { delta?: { content?: string | null } }[];
};

/**
 * Reads a Workers AI chat-completions SSE stream (TDD §7.4.1). Forwards only `delta.content` (never reasoning)
 * and takes usage from the final `{"response":"","usage":…}` line. Without that line, per-chunk usage is summed.
 */
export async function parseSse(body: ReadableStream<Uint8Array>, onDelta: (text: string) => void): Promise<{ text: string; usage?: RawUsage }> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let text = "";
  let final: RawUsage | undefined;
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
  return { text, usage: final ?? (summed.completion_tokens ? summed : undefined) };
}

/**
 * Streams a text answer (narration, D4). Falls back to the second model only before the first delta;
 * a stream that breaks later throws `LlmUnavailable`, and the caller uses the template instead.
 */
export async function streamLlm(deps: LlmDeps, req: LlmRequest, onDelta: (text: string) => void): Promise<LlmResult> {
  if (deps.mode === "mock") return mockStream(req, onDelta);
  let sent = false;
  const forward = (t: string) => {
    sent = true;
    onDelta(t);
  };
  return withFallback(
    deps,
    async (model, fallback) => {
      const body = await run(deps, model, buildInput(model, req, true));
      if (!(body instanceof ReadableStream)) throw new Error("expected a stream");
      const { text, usage } = await parseSse(body as ReadableStream<Uint8Array>, forward);
      const result: LlmResult = { toolCalls: [], usage: toUsage(model, usage), model, fallback };
      await deps.usage.add(result.usage.neurons);
      if (!text) throw new Error("empty stream");
      return { ...result, text };
    },
    () => !sent,
  );
}
