import { z } from "zod";

/** Demo service modes (TDD §7.5). Shared by the demo Worker, the main Worker's `/api/demo` and the UI. */
export const DEMO_MODES = ["healthy", "slow", "errors", "redirect_loop", "bad_cache"] as const;
export type DemoMode = (typeof DEMO_MODES)[number];

/** The main problems: each changes how the page answers, so only one can be on at a time. */
export const DEMO_PROBLEMS = ["errors", "redirect_loop", "bad_cache"] as const;
export type DemoProblem = (typeof DEMO_PROBLEMS)[number];

export const DEMO_MODE_LABELS: Record<DemoMode, string> = {
  healthy: "Healthy",
  slow: "Slow (+3 s)",
  errors: "500 errors",
  redirect_loop: "Redirect loop",
  bad_cache: "Bad caching",
};

/**
 * A valid set of modes, in canonical order: `["healthy"]` alone, or at most one main problem plus an
 * optional `slow` (every part stays visible to the diagnosis). Anything else is null.
 */
export function normalizeModes(modes: readonly DemoMode[]): DemoMode[] | null {
  const set = new Set(modes);
  if (set.size === 0) return null;
  if (set.has("healthy")) return set.size === 1 ? ["healthy"] : null;
  if (DEMO_PROBLEMS.filter((p) => set.has(p)).length > 1) return null;
  return DEMO_MODES.filter((m) => set.has(m));
}

/** Builds a valid set from the panel's two controls: the main problem (or none) and the slow switch. */
export function modesFrom(problem: DemoProblem | null, slow: boolean): DemoMode[] {
  const modes: DemoMode[] = [...(slow ? ["slow" as const] : []), ...(problem ? [problem] : [])];
  return modes.length ? modes : ["healthy"];
}

// Pure, so the web bundle (which only needs the lists, labels and helpers) drops zod.
export const DemoModesSchema = /* @__PURE__ */ z
  .array(z.enum(DEMO_MODES))
  .max(DEMO_MODES.length)
  .transform((m, ctx) => normalizeModes(m) ?? (ctx.addIssue({ code: "custom", message: "invalid_modes" }), z.NEVER));
