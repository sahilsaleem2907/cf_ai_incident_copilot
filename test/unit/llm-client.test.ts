import { describe, expect, it, vi } from "vitest";
import { buildInput, callLlm, failureKind, type AiRunner, type LlmDeps } from "../../worker/llm/client";
import { FALLBACK, LlmUnavailable, neuronsFor, PRIMARY, toResult, type ChatCompletion, type LlmRequest } from "../../worker/llm/models";
import type { UsageSink } from "../../worker/llm/usage";

import errorsJson from "../fixtures/llm/errors.json";
import glmFollowup from "../fixtures/llm/glm-4.7-flash/followup-no-tool-choice.json";
import glmText from "../fixtures/llm/glm-4.7-flash/text.json";
import glmToolCall from "../fixtures/llm/glm-4.7-flash/tool-call.json";
import gptRequired from "../fixtures/llm/gpt-oss-120b/followup-tool-choice-required.json";
import gptText from "../fixtures/llm/gpt-oss-120b/text.json";
import gptToolCall from "../fixtures/llm/gpt-oss-120b/tool-call.json";

const FIXTURES: Record<string, unknown> = {
  "gpt-oss-120b/text.json": gptText,
  "gpt-oss-120b/tool-call.json": gptToolCall,
  "gpt-oss-120b/followup-tool-choice-required.json": gptRequired,
  "glm-4.7-flash/text.json": glmText,
  "glm-4.7-flash/tool-call.json": glmToolCall,
  "glm-4.7-flash/followup-no-tool-choice.json": glmFollowup,
};
const fixture = (path: string) => structuredClone(FIXTURES[path]) as ChatCompletion;
const errors = errorsJson as Record<string, { name: string; message: string }>;

const aiError = (key: string) => Object.assign(new Error(errors[key]!.message), { name: errors[key]!.name });

function usageSpy() {
  const sink = { add: vi.fn(async () => {}), exhausted: vi.fn(async () => {}), today: vi.fn(async () => 0) } satisfies UsageSink;
  return sink;
}

function deps(run: AiRunner["run"], extra: Partial<LlmDeps> = {}) {
  const ai = { run: vi.fn(run) };
  const usage = usageSpy();
  return { ai, usage, deps: { ai, gatewayId: "incident-copilot", mode: "live", usage, ...extra } satisfies LlmDeps };
}

const req: LlmRequest = { system: "sys", messages: [{ role: "user", content: "q" }], maxTokens: 300 };
const planReq: LlmRequest = { ...req, tools: [{ type: "function", function: { name: "dns_lookup", description: "d", parameters: {} } }], toolChoice: "required" };

describe("toResult (recorded responses)", () => {
  it.each(["gpt-oss-120b", "glm-4.7-flash"])("%s plain text ignores reasoning", (m) => {
    const r = toResult(`@cf/x/${m}`, fixture(`${m}/text.json`));
    expect(r.text).toBeTruthy();
    expect(r.toolCalls).toEqual([]);
    expect(JSON.stringify(r)).not.toContain("reasoning");
    expect(r.usage.neurons).toBeGreaterThan(0);
  });

  it.each(["gpt-oss-120b", "glm-4.7-flash"])("%s tool call parses JSON-string arguments", (m) => {
    const r = toResult(`@cf/x/${m}`, fixture(`${m}/tool-call.json`));
    expect(r.text).toBeUndefined();
    expect(r.toolCalls[0]).toMatchObject({ name: "dns_lookup", args: { hostname: "example.com" } });
    expect(r.toolCalls[0]!.id).toBeTruthy();
  });

  it("gpt with tool_choice required calls submit_findings", () => {
    const r = toResult(PRIMARY, fixture("gpt-oss-120b/followup-tool-choice-required.json"));
    expect(r.toolCalls.map((c) => c.name)).toEqual(["submit_findings"]);
    expect(r.toolCalls[0]!.args).toMatchObject({ category: "healthy" });
  });

  it("drops glm's prose next to a tool call", () => {
    const r = toResult(FALLBACK, fixture("glm-4.7-flash/followup-no-tool-choice.json"));
    expect(r.text).toBeUndefined();
    expect(r.toolCalls.map((c) => c.name)).toEqual(["submit_findings"]);
  });

  it("flags an answer cut off at max_tokens", () => {
    const r = toResult(PRIMARY, { choices: [{ finish_reason: "length", message: { tool_calls: [{ id: "c1", function: { name: "submit_findings", arguments: '{"category": "origin_5xx", "cau' } }] } }] });
    expect(r).toMatchObject({ truncated: true, toolCalls: [{ args: null }] });
    expect(toResult(PRIMARY, fixture("gpt-oss-120b/text.json"))).not.toHaveProperty("truncated");
  });

  it("keeps bad argument JSON as argsError", () => {
    const r = toResult(PRIMARY, { choices: [{ message: { tool_calls: [{ id: "c1", function: { name: "http_probe", arguments: "{not json" } }] } }] });
    expect(r.toolCalls[0]).toMatchObject({ name: "http_probe", args: null, argsError: expect.stringContaining("not valid JSON") });
  });

  it("estimates neurons from tokens when usage.neurons is missing", () => {
    expect(neuronsFor(FALLBACK, { prompt_tokens: 1_000_000, completion_tokens: 0 })).toBeCloseTo(5_500);
    expect(neuronsFor(PRIMARY, { prompt_tokens: 0, completion_tokens: 1_000_000 })).toBeCloseTo(68_182);
    expect(neuronsFor(PRIMARY, { neurons: 12.5 })).toBe(12.5);
  });
});

describe("buildInput", () => {
  it("sends the system prompt, tools, tool_choice and max_tokens", () => {
    expect(buildInput(PRIMARY, planReq, false)).toEqual({
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "q" },
      ],
      tools: planReq.tools,
      tool_choice: "required",
      max_tokens: 300,
    });
  });
  it("always turns glm's thinking off", () => {
    expect(buildInput(FALLBACK, req, true)).toMatchObject({ stream: true, chat_template_kwargs: { enable_thinking: false } });
  });
  it("omits tool_choice without tools", () => {
    expect(buildInput(PRIMARY, { ...req, toolChoice: "required" }, false)).not.toHaveProperty("tool_choice");
  });
});

describe("callLlm", () => {
  it("calls the primary through the gateway and records neurons", async () => {
    const { ai, usage, deps: d } = deps(async () => fixture("gpt-oss-120b/tool-call.json"));
    const r = await callLlm(d, planReq);
    expect(r).toMatchObject({ model: PRIMARY, fallback: false });
    expect(ai.run).toHaveBeenCalledWith(PRIMARY, expect.objectContaining({ tool_choice: "required" }), { gateway: { id: "incident-copilot" } });
    expect(usage.add).toHaveBeenCalledWith(r.usage.neurons);
  });

  it("falls back on a primary error", async () => {
    const { ai, deps: d } = deps(async (model) => {
      if (model === PRIMARY) throw aiError("no_such_model");
      return fixture("glm-4.7-flash/text.json");
    });
    const r = await callLlm(d, req);
    expect(r).toMatchObject({ model: FALLBACK, fallback: true });
    expect(ai.run).toHaveBeenCalledTimes(2);
    expect(ai.run.mock.calls[1]![1]).toMatchObject({ chat_template_kwargs: { enable_thinking: false } });
  });

  it("falls back on a 429", async () => {
    const { deps: d } = deps(async (model) => {
      if (model === PRIMARY) throw new Error("3040: Capacity temporarily exceeded, please try again (429)");
      return fixture("glm-4.7-flash/text.json");
    });
    expect((await callLlm(d, req)).fallback).toBe(true);
  });

  it("falls back on an empty response", async () => {
    const { deps: d } = deps(async (model) => (model === PRIMARY ? { choices: [{ message: { content: null } }] } : fixture("glm-4.7-flash/text.json")));
    expect((await callLlm(d, req)).model).toBe(FALLBACK);
  });

  it("falls back on a timeout", async () => {
    const { deps: d } = deps(async (model) => (model === PRIMARY ? new Promise(() => {}) : fixture("glm-4.7-flash/text.json")), { timeoutMs: 20 });
    expect((await callLlm(d, req)).model).toBe(FALLBACK);
  });

  it("doesn't try the fallback when the gateway isn't configured", async () => {
    const { ai, deps: d } = deps(async () => {
      throw aiError("gateway_not_configured");
    });
    await expect(callLlm(d, req)).rejects.toMatchObject({ name: "LlmUnavailable", reason: "config" });
    expect(ai.run).toHaveBeenCalledTimes(1);
  });

  it("marks the day as spent when the allocation is used up", async () => {
    const { ai, usage, deps: d } = deps(async () => {
      throw new Error("4006: you have used up your daily free allocation of 10,000 neurons");
    });
    await expect(callLlm(d, req)).rejects.toMatchObject({ reason: "allocation" });
    expect(usage.exhausted).toHaveBeenCalledOnce();
    expect(ai.run).toHaveBeenCalledTimes(1);
  });

  it("throws LlmUnavailable when both models fail", async () => {
    const { ai, deps: d } = deps(async () => {
      throw aiError("no_such_model");
    });
    const err = await callLlm(d, req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmUnavailable);
    expect(err).toMatchObject({ reason: "failed", message: expect.stringContaining(FALLBACK) });
    expect(ai.run).toHaveBeenCalledTimes(2);
  });

  it("uses the mock without touching AI in mock mode", async () => {
    const { ai, deps: d } = deps(async () => ({}), { mode: "mock" });
    const r = await callLlm(d, req);
    expect(r.model).toBe("mock");
    expect(ai.run).not.toHaveBeenCalled();
  });
});

describe("failureKind", () => {
  it("reads the Workers AI error codes", () => {
    expect(failureKind(aiError("gateway_not_configured"))).toBe("config");
    expect(failureKind(aiError("no_such_model"))).toBe("retry");
    expect(failureKind(new Error("daily free allocation exceeded"))).toBe("allocation");
  });
});
