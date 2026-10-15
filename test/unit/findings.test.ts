import { describe, expect, it } from "vitest";
import { toResult, type ChatCompletion } from "../../worker/llm/models";
import type { Findings } from "../../worker/diagnosis/categories";
import { parseFindings, salvageFindings, submitFindingsTool } from "../../worker/loop/findings";
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

describe("salvageFindings (keep the model's work when its call is invalid or cut off)", () => {
  const rules: Findings = {
    category: "origin_5xx",
    confidence: "medium",
    evidence: ["http-1"],
    cause: "The origin returns HTTP 500 on 2/3 samples [http-1].",
    next_steps: ["Check the origin's logs."],
    actions: ["restore_demo_service"],
  };
  const known = ["dns-1", "http-1", "http-2"];

  it("keeps the model's valid fields and replaces sentence evidence with known IDs", () => {
    const args = { category: "high_latency", confidence: "high", evidence: ["[http-2] took 3 s", "http-2", "dns-9"], cause: "The origin is slow.", next_steps: ["Profile the app."] };
    expect(salvageFindings(args, rules, known)).toEqual({
      findings: { category: "high_latency", confidence: "high", evidence: ["http-2"], cause: "The origin is slow.", next_steps: ["Profile the app."], actions: ["restore_demo_service"] },
      fromModel: ["category", "evidence", "confidence", "cause", "next_steps"],
    });
  });

  it("uses the rules' evidence when none of the model's IDs are real", () => {
    const r = salvageFindings({ category: "high_latency", evidence: ["The site is slow"] }, rules, known);
    expect(r.findings).toMatchObject({ category: "high_latency", evidence: ["http-1"], confidence: "medium", cause: rules.cause });
    expect(r.fromModel).toEqual(["category"]);
  });

  it("fills fields cut off by max_tokens from the rules", () => {
    const r = salvageFindings({ category: "origin_5xx", confidence: "high", evidence: ["http-1"] }, rules, known);
    expect(r.findings).toEqual({ ...rules, confidence: "high" });
  });

  it("drops an invalid field but keeps the rest", () => {
    const r = salvageFindings({ category: "origin_5xx", cause: "x".repeat(400), actions: ["delete_everything"], next_steps: [] }, rules, known);
    expect(r.findings).toMatchObject({ cause: rules.cause, actions: rules.actions, next_steps: [] });
  });

  it("falls back to the rules entirely without a valid category", () => {
    expect(salvageFindings({ category: "aliens", cause: "Martians." }, rules, known)).toEqual({ findings: rules, fromModel: [] });
    expect(salvageFindings(null, rules, known)).toEqual({ findings: rules, fromModel: [] });
  });
});
