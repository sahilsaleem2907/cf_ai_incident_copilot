import { describe, expect, it } from "vitest";
import { BudgetExceededError, countingFetch, SubrequestBudget, SubrequestCounter, SUBREQUEST_BUDGET } from "../../worker/loop/budget";
import { fakeFetch } from "./helpers/fake-fetch";

describe("SubrequestBudget", () => {
  it("reserves the worst case and settles the actual cost", () => {
    const b = new SubrequestBudget();
    expect(b.limit).toBe(SUBREQUEST_BUDGET);
    expect(b.reserve(19)).toBe(true);
    expect(b.remaining()).toBe(26);
    b.settle(19, 7);
    expect(b.spent).toBe(7);
    expect(b.remaining()).toBe(38);
  });

  it("refuses a reservation that doesn't fit", () => {
    const b = new SubrequestBudget(45, 40);
    expect(b.reserve(6)).toBe(false);
    expect(b.reserve(5)).toBe(true);
    expect(b.reserve(1)).toBe(false);
  });

  it("round-trips through JSON (run row between Workflow steps)", () => {
    const b = new SubrequestBudget(45, 12);
    b.reserve(4);
    const copy = SubrequestBudget.from(JSON.parse(JSON.stringify(b)));
    expect(copy.toJSON()).toEqual({ limit: 45, used: 12, reserved: 4 });
    expect(copy.remaining()).toBe(29);
  });
});

describe("countingFetch", () => {
  it("counts calls and throws once the limit is reached", async () => {
    const inner = fakeFetch(() => new Response("ok"));
    const counter = new SubrequestCounter(2);
    const f = countingFetch(inner, counter);
    await f("https://a.example.com/");
    await f("https://b.example.com/");
    await expect(f("https://c.example.com/")).rejects.toBeInstanceOf(BudgetExceededError);
    expect(counter.count).toBe(2);
    expect(inner.calls).toHaveLength(2);
  });
});
