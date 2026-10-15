import { describe, expect, it } from "vitest";
import { ACTION_TITLES, isOwnDemo, pickAction, proposable, type ProposeContext } from "../../worker/actions/catalog";
import { ACTION_IDS } from "../../worker/diagnosis/categories";

const WS = "0123456789abcdef0123456789abcdef";
const DEMO = "https://incident-copilot-demo.acme.workers.dev";
const ctx = (over: Partial<ProposeContext> = {}): ProposeContext => ({
  target: `${DEMO}/w/${WS}/`,
  workspaceId: WS,
  demoBaseUrl: DEMO,
  category: "origin_5xx",
  status: "investigating",
  ...over,
});

describe("isOwnDemo", () => {
  it("matches this workspace's demo pages only", () => {
    expect(isOwnDemo(`${DEMO}/w/${WS}/`, WS, DEMO)).toBe(true);
    expect(isOwnDemo(`${DEMO}/w/${WS}/static/app.css`, WS, DEMO)).toBe(true);
    expect(isOwnDemo(`${DEMO}/w/fedcba9876543210fedcba9876543210/`, WS, DEMO)).toBe(false);
    expect(isOwnDemo(`https://shop.example.com/w/${WS}/`, WS, DEMO)).toBe(false);
    expect(isOwnDemo(`${DEMO}/`, WS, DEMO)).toBe(false);
    expect(isOwnDemo(`${DEMO}/w/${WS}/`, WS, "https://incident-copilot-demo.<sub>.workers.dev")).toBe(false);
  });
});

describe("proposable", () => {
  it("restore_demo_service: own broken demo, while investigating or awaiting approval", () => {
    expect(proposable("restore_demo_service", ctx())).toBe(true);
    expect(proposable("restore_demo_service", ctx({ status: "awaiting_approval", category: "inconclusive" }))).toBe(true);
    expect(proposable("restore_demo_service", ctx({ category: "healthy" }))).toBe(false);
    expect(proposable("restore_demo_service", ctx({ target: "https://shop.example.com/" }))).toBe(false);
    expect(proposable("restore_demo_service", ctx({ status: "mitigated" }))).toBe(false);
    expect(proposable("restore_demo_service", ctx({ status: "resolved" }))).toBe(false);
  });

  it("keeps the actions of later WPs switched off", () => {
    for (const a of ["add_to_watchlist", "recheck_burst", "generate_postmortem"] as const) expect(proposable(a, ctx())).toBe(false);
  });
});

describe("pickAction", () => {
  it("adds the rule action when the model left it out (user decision, WP-12)", () => {
    expect(pickAction({ category: "high_latency", actions: [] }, ctx())).toBe("restore_demo_service");
    expect(pickAction({ category: "redirect_loop", actions: ["add_to_watchlist"] }, ctx())).toBe("restore_demo_service");
  });

  it("proposes nothing for a healthy demo or a site that isn't the demo", () => {
    expect(pickAction({ category: "healthy", actions: ["restore_demo_service"] }, ctx({ category: "healthy" }))).toBeNull();
    expect(pickAction({ category: "origin_5xx", actions: ["restore_demo_service"] }, ctx({ target: "https://shop.example.com/" }))).toBeNull();
  });

  it("has a title for every action", () => {
    for (const a of ACTION_IDS) expect(ACTION_TITLES[a]).toBeTruthy();
  });
});
