import type { IncidentStatus } from "../agent/state";
import { ACTION_IDS, type ActionId, type Category, type Findings } from "../diagnosis/categories";

/**
 * Action catalog (TDD §7.6). The model and the rules only *name* actions; this decides which one is shown as
 * an approval card, and nothing runs until a human approves it (FR-20, FR-24).
 */
export const ACTION_TITLES: Record<ActionId, string> = {
  restore_demo_service: "Restore the demo service to healthy",
  add_to_watchlist: "Add this endpoint to the watchlist",
  recheck_burst: "Re-check every minute for 15 minutes",
  generate_postmortem: "Write a postmortem",
};

export type ProposeContext = {
  target: string;
  workspaceId: string;
  demoBaseUrl: string;
  category: Category;
  status: IncidentStatus;
};

/** True when the target is this workspace's own demo page: someone else's demo, or any other site, is off limits. */
export function isOwnDemo(target: string, workspaceId: string, demoBaseUrl: string): boolean {
  if (!URL.canParse(target) || !URL.canParse(demoBaseUrl)) return false;
  const t = new URL(target);
  return t.origin === new URL(demoBaseUrl).origin && t.pathname.startsWith(`/w/${workspaceId}/`);
}

export function proposable(action: ActionId, ctx: ProposeContext): boolean {
  // A new card only fits these statuses (TDD §10): mitigated and resolved have no edge to awaiting_approval.
  if (ctx.status !== "investigating" && ctx.status !== "awaiting_approval") return false;
  switch (action) {
    case "restore_demo_service":
      return ctx.category !== "healthy" && isOwnDemo(ctx.target, ctx.workspaceId, ctx.demoBaseUrl);
    // Switched on by their WPs: add_to_watchlist (WP-18), generate_postmortem (WP-22), recheck_burst (WP-24).
    case "add_to_watchlist":
    case "recheck_burst":
    case "generate_postmortem":
      return false;
  }
}

/**
 * The model's actions first, then the rule actions, so a broken demo always gets "Restore demo service"
 * even when the model leaves it out (user decision, WP-12). The first proposable one wins (one per run).
 */
export function pickAction(findings: Pick<Findings, "category" | "actions">, ctx: ProposeContext): ActionId | null {
  const rules: ActionId[] = findings.category === "healthy" ? [] : ["restore_demo_service"];
  const candidates = [...new Set([...findings.actions, ...rules])].filter((a): a is ActionId => (ACTION_IDS as readonly string[]).includes(a));
  return candidates.find((a) => proposable(a, ctx)) ?? null;
}

export type ActionOutcome = { ok: boolean; text: string };

/** Runs an approved action. Idempotent: a retried Workflow step may call it again. */
export async function execute(action: ActionId, env: Pick<Env, "DEMO">, workspaceId: string): Promise<ActionOutcome> {
  switch (action) {
    case "restore_demo_service":
      await env.DEMO.setModes(workspaceId, ["healthy"]);
      return { ok: true, text: "The demo service is back in healthy mode." };
    default:
      return { ok: false, text: `${ACTION_TITLES[action]} isn't available yet.` };
  }
}
