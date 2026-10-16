import type { IncidentStatus } from "../agent/state";
import { ACTION_IDS, type ActionId, type Category, type Findings } from "../diagnosis/categories";
import { LIMITS } from "../lib/limits";
import { createWatch, listWatches } from "../watch/store";

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
  /** The incident isn't watched yet, its URL isn't on the workspace's watchlist, and the caps allow one more. */
  watchable: boolean;
  /** A postmortem is already stored (WP-22). */
  hasPostmortem: boolean;
  /** A monitor (post-action or burst) is already checking this incident (WP-24). */
  monitorRunning: boolean;
};

/** True when the target is this workspace's own demo page: someone else's demo, or any other site, is off limits. */
export function isOwnDemo(target: string, workspaceId: string, demoBaseUrl: string): boolean {
  if (!URL.canParse(target) || !URL.canParse(demoBaseUrl)) return false;
  const t = new URL(target);
  return t.origin === new URL(demoBaseUrl).origin && t.pathname.startsWith(`/w/${workspaceId}/`);
}

export function proposable(action: ActionId, ctx: ProposeContext): boolean {
  // WP-22: a postmortem is the one card for a resolved incident (a follow-up asks for it); no status change.
  if (action === "generate_postmortem") return ctx.status === "resolved" && !ctx.hasPostmortem;
  // A new card only fits these statuses (TDD §10): mitigated and resolved have no edge to awaiting_approval.
  if (ctx.status !== "investigating" && ctx.status !== "awaiting_approval") return false;
  switch (action) {
    case "restore_demo_service":
      return ctx.category !== "healthy" && isOwnDemo(ctx.target, ctx.workspaceId, ctx.demoBaseUrl);
    case "add_to_watchlist":
      // A real site that's broken: watching it tells the user when it recovers. The demo gets a restore instead.
      return ctx.category !== "healthy" && ctx.watchable && !isOwnDemo(ctx.target, ctx.workspaceId, ctx.demoBaseUrl);
    // WP-24: checks every minute for 15 minutes; one monitor at a time.
    case "recheck_burst":
      return ctx.category !== "healthy" && !ctx.monitorRunning;
  }
}

/**
 * One action per run (D13). A restore that fits always wins, since a fix beats watching (WP-18). Otherwise the
 * model's actions come first, then the rule actions, so a broken demo always gets "Restore demo service" and a
 * broken real site "Add to watchlist" even when the model leaves them out (user decisions, WP-12 and WP-18).
 */
export function pickAction(findings: Pick<Findings, "category" | "actions">, ctx: ProposeContext): ActionId | null {
  if (proposable("restore_demo_service", ctx)) return "restore_demo_service";
  // WP-24 (user decision): an inconclusive result often means a flaky site, so re-checking every minute comes first.
  const rules: ActionId[] = findings.category === "healthy" ? [] : findings.category === "inconclusive" ? ["recheck_burst", "add_to_watchlist"] : ["add_to_watchlist"];
  const candidates = [...new Set([...findings.actions, ...rules])].filter((a): a is ActionId => (ACTION_IDS as readonly string[]).includes(a));
  return candidates.find((a) => proposable(a, ctx)) ?? null;
}

/** `watchId`: the watch an `add_to_watchlist` created or found, for the incident to link to. */
export type ActionOutcome = { ok: boolean; text: string; watchId?: string };

export type ExecuteContext = { env: Pick<Env, "DEMO" | "DB">; workspaceId: string; incidentId: string; target: string };

export const WATCH_ADDED_TEXT = `Added to the watchlist: checked every ${LIMITS.watchMinIntervalSec / 60} minutes for ${LIMITS.watchTtlHours} hours. This incident resolves itself after 3 passing checks in a row.`;

/** Runs an approved action. Idempotent: a retried Workflow step may call it again. */
export async function execute(action: ActionId, ctx: ExecuteContext): Promise<ActionOutcome> {
  switch (action) {
    case "restore_demo_service":
      await ctx.env.DEMO.setModes(ctx.workspaceId, ["healthy"]);
      return { ok: true, text: "The demo service is back in healthy mode." };
    case "add_to_watchlist": {
      const r = await createWatch(ctx.env.DB, { workspaceId: ctx.workspaceId, url: ctx.target, intervalSec: LIMITS.watchMinIntervalSec, openIncidentId: ctx.incidentId });
      if (r.ok) return { ok: true, text: WATCH_ADDED_TEXT, watchId: r.watch.id };
      // A retried step finds its own watch.
      const mine = (await listWatches(ctx.env.DB, ctx.workspaceId)).find((w) => w.url === ctx.target && w.open_incident_id === ctx.incidentId);
      if (mine) return { ok: true, text: WATCH_ADDED_TEXT, watchId: mine.id };
      const why = { already_watched: "this URL is already on the watchlist", watch_limit: "the watchlist is full (3 per workspace)", watch_capacity: "the app is at its limit of 30 watches" }[r.error];
      return { ok: false, text: `Couldn't add the watch: ${why}.` };
    }
    // generate_postmortem is run by the agent itself (it owns the incident's records).
    default:
      return { ok: false, text: `${ACTION_TITLES[action]} isn't available yet.` };
  }
}
