import { useKumoToastManager } from "@cloudflare/kumo";
import { useCallback } from "react";
import { rateLimitedText, retryText } from "../lib/api";

/**
 * A 429 from the run quota (TDD §11): shows a warning toast with the time until reset and returns the same
 * text for the inline `role="alert"` line, so screen readers hear it too.
 */
export function useRateLimitToast(): (retryAfter: number) => string {
  const toasts = useKumoToastManager();
  return useCallback(
    (retryAfter: number) => {
      toasts.add({ title: "Run limit reached", description: `Try again in ${retryText(retryAfter)}.`, variant: "warning" });
      return rateLimitedText(retryAfter);
    },
    [toasts],
  );
}
