import { describe, expect, it, vi } from "vitest";
import type { LlmDeps } from "../../worker/llm/client";
import { FALLBACK, PRIMARY } from "../../worker/llm/models";
import { parseSse, streamLlm } from "../../worker/llm/stream";

import glmStream from "../fixtures/llm/glm-4.7-flash/stream.sse?raw";
import gptStream from "../fixtures/llm/gpt-oss-120b/stream.sse?raw";

const SSE: Record<string, string> = { "gpt-oss-120b/stream.sse": gptStream, "glm-4.7-flash/stream.sse": glmStream };
const sse = (path: string) => SSE[path]!;

/** Splits the text into odd-sized byte chunks so lines straddle chunk boundaries. */
function toStream(text: string, chunk = 37): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, (i += chunk)));
    },
  });
}

/** What the fixture's content deltas add up to, read independently of the parser. */
function expectedText(raw: string): string {
  return raw
    .split("\n")
    .filter((l) => l.startsWith("data: {") && l.includes('"choices"'))
    .map((l) => (JSON.parse(l.slice(6)) as { choices: { delta?: { content?: string | null } }[] }).choices[0]?.delta?.content ?? "")
    .join("");
}

describe("parseSse (recorded streams)", () => {
  it.each(["gpt-oss-120b", "glm-4.7-flash"])("%s: forwards content deltas and takes usage from the final line", async (m) => {
    const raw = sse(`${m}/stream.sse`);
    const deltas: string[] = [];
    const { text, usage } = await parseSse(toStream(raw), (d) => deltas.push(d));
    expect(text).toBe(expectedText(raw));
    expect(text.length).toBeGreaterThan(10);
    expect(deltas.join("")).toBe(text);
    expect(usage?.neurons).toBeGreaterThan(0);
    const final = raw.split("\n").find((l: string) => l.startsWith('data: {"response"'))!;
    expect(usage).toEqual((JSON.parse(final.slice(6)) as { usage: unknown }).usage);
  });

  it("never forwards reasoning", async () => {
    const lines = [
      { choices: [{ delta: { reasoning: "secret plan", reasoning_content: "secret plan" } }] },
      { choices: [{ delta: { content: "Hello" } }] },
    ];
    const body = lines.map((l) => `data: ${JSON.stringify(l)}\n\n`).join("") + "data: [DONE]\n\n";
    const { text } = await parseSse(toStream(body, 5), () => {});
    expect(text).toBe("Hello");
  });

  it("sums per-chunk usage when the final usage line is missing", async () => {
    const body = [1, 2].map((n) => `data: ${JSON.stringify({ choices: [{ delta: { content: `t${n}` } }], usage: { prompt_tokens: 10, completion_tokens: 1 } })}\n`).join("");
    expect((await parseSse(toStream(body), () => {})).usage).toEqual({ prompt_tokens: 10, completion_tokens: 2 });
  });
});

describe("streamLlm", () => {
  const req = { system: "s", messages: [{ role: "user" as const, content: "q" }], maxTokens: 200 };
  const usage = { add: vi.fn(async () => {}), exhausted: vi.fn(async () => {}), today: vi.fn(async () => 0) };
  const deps = (run: LlmDeps["ai"]["run"]): LlmDeps => ({ ai: { run: vi.fn(run) }, gatewayId: "g", mode: "live", usage });

  it("streams the primary and records neurons", async () => {
    const d = deps(async () => toStream(sse("gpt-oss-120b/stream.sse")));
    const deltas: string[] = [];
    const r = await streamLlm(d, req, (t) => deltas.push(t));
    expect(r).toMatchObject({ model: PRIMARY, fallback: false, toolCalls: [] });
    expect(r.text).toBe(deltas.join(""));
    expect(d.ai.run).toHaveBeenCalledWith(PRIMARY, expect.objectContaining({ stream: true }), { gateway: { id: "g" } });
    expect(usage.add).toHaveBeenCalledWith(r.usage.neurons);
  });

  it("falls back before the first delta", async () => {
    const d = deps(async (model) => {
      if (model === PRIMARY) throw new Error("5007: No such model");
      return toStream(sse("glm-4.7-flash/stream.sse"));
    });
    const r = await streamLlm(d, req, () => {});
    expect(r).toMatchObject({ model: FALLBACK, fallback: true });
  });

  it("doesn't fall back once text has been sent", async () => {
    let pulls = 0;
    const broken = new ReadableStream<Uint8Array>({
      pull(c) {
        if (pulls++ === 0) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "Partial" } }] })}\n`));
        else c.error(new Error("connection reset"));
      },
    });
    const d = deps(async () => broken);
    const deltas: string[] = [];
    await expect(streamLlm(d, req, (t) => deltas.push(t))).rejects.toMatchObject({ name: "LlmUnavailable", reason: "failed" });
    expect(deltas).toEqual(["Partial"]);
    expect(d.ai.run).toHaveBeenCalledTimes(1);
  });

  it("streams canned text in mock mode", async () => {
    const d: LlmDeps = { ...deps(async () => ({})), mode: "mock" };
    const deltas: string[] = [];
    const r = await streamLlm(d, req, (t) => deltas.push(t));
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join("")).toBe(r.text);
  });
});
