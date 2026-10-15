import { z } from "zod";

/** Demo service modes (TDD §7.5). Shared by the demo Worker, the main Worker's `/api/demo` and the UI. */
export const DEMO_MODES = ["healthy", "slow", "errors", "redirect_loop", "bad_cache"] as const;
export type DemoMode = (typeof DEMO_MODES)[number];
// Pure, so the web bundle (which only needs the list and labels) drops zod.
export const DemoModeSchema = /* @__PURE__ */ z.enum(DEMO_MODES);

export const DEMO_MODE_LABELS: Record<DemoMode, string> = {
  healthy: "Healthy",
  slow: "Slow (+3 s)",
  errors: "500 errors",
  redirect_loop: "Redirect loop",
  bad_cache: "Bad caching",
};
