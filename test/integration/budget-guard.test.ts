import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { incidentAgent } from "../../worker/agent/stub";
import { newId } from "../../worker/lib/ids";
import { BUDGET_GUARD_AT } from "../../worker/loop/budget";

// D1 is per test file, so the forced total here can't reach other files' runs; it's cleared after each test.
const BASE = "https://copilot.example.com";
const today = () => new Date().toISOString().slice(0, 10);
const setToday = (neurons: number) =>
  env.DB.prepare("INSERT INTO llm_usage (day, neurons_est) VALUES (?1, ?2) ON CONFLICT(day) DO UPDATE SET neurons_est = excluded.neurons_est")
    .bind(today(), neurons)
    .run();

async function budgetMode(): Promise<string> {
  return (await (await exports.default.fetch(`${BASE}/api/session`)).json<{ budgetMode: string }>()).budgetMode;
}

async function firstRunMode(mode?: "rule_based"): Promise<string> {
  const agent = await incidentAgent(env, newId());
  const { runId } = await agent.init({ workspaceId: newId(), target: "https://shop.example.com/", origin: "chat", message: "why?", ...(mode ? { mode } : {}) });
  return (await agent.getRunContext(runId!)).mode;
}

describe("budget guard (TDD §11)", () => {
  afterEach(async () => {
    await env.DB.prepare("DELETE FROM llm_usage WHERE day = ?").bind(today()).run();
  });

  it("stays on AI below 9,000 neurons today", async () => {
    await setToday(BUDGET_GUARD_AT - 1);
    expect(await budgetMode()).toBe("ai");
    expect(await firstRunMode()).toBe("ai");
  });

  it("switches new runs and the session to rule-based at 9,000", async () => {
    await setToday(BUDGET_GUARD_AT);
    expect(await budgetMode()).toBe("rule_based");
    expect(await firstRunMode()).toBe("rule_based");
    expect(await firstRunMode("rule_based")).toBe("rule_based");
  });
});
