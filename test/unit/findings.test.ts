import { describe, expect, it } from "vitest";
import { toResult, type ChatCompletion } from "../../worker/llm/models";
import { parseFindings, submitFindingsTool } from "../../worker/loop/findings";
import glmFollowup from "../fixtures/llm/glm-4.7-flash/followup-no-tool-choice.json";
import gptRequired from "../fixtures/llm/gpt-oss-120b/followup-tool-choice-required.json";

const valid = {
  category: "origin_5xx",
  confidence: "high",
  evidence: ["http-1", "[dns-1]"],
  cause: "The origin returns HTTP 500.",
  next_steps: ["Check the logs."],
  actions: ["restore_demo_service"],
};

describe("submit_findings schema", () => {
  it("accepts IDs with or without brackets and normalizes them", () => {
    const r = parseFindings({ ...valid, evidence: ["http-1", "[dns-1]", "[http-1]"] });
    expect(r).toEqual({ ok: true, findings: { ...valid, evidence: ["http-1", "dns-1"] } });
  });

  it("defaults next_steps and actions", () => {
    const { category, confidence, evidence, cause } = valid;
    expect(parseFindings({ category, confidence, evidence, cause })).toMatchObject({ ok: true, findings: { next_steps: [], actions: [] } });
  });

  it("rejects the sentence evidence both models produced in the spike", () => {
    for (const raw of [gptRequired, glmFollowup]) {
      const args = toResult("m", raw as ChatCompletion).toolCalls[0]!.args;
      const r = parseFindings(args);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain("evidence ID");
    }
  });

  it.each([
    ["unknown category", { category: "aliens" }],
    ["no evidence", { evidence: [] }],
    ["a long cause", { cause: "x".repeat(301) }],
    ["five next steps", { next_steps: ["a", "b", "c", "d", "e"] }],
    ["two actions", { actions: ["restore_demo_service", "recheck_burst"] }],
    ["an unknown action", { actions: ["delete_everything"] }],
  ])("rejects %s", (_name, patch) => {
    expect(parseFindings({ ...valid, ...patch }).ok).toBe(false);
  });

  it("exposes an OpenAI tool definition without $schema", () => {
    const tool = submitFindingsTool();
    expect(tool.function.name).toBe("submit_findings");
    expect(tool.function.parameters).not.toHaveProperty("$schema");
    expect(tool.function.parameters).toMatchObject({ required: expect.arrayContaining(["category", "confidence", "evidence", "cause"]) });
  });
});
