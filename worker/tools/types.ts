import type { Fetch } from "../lib/doh";

export type ToolName = "dns_lookup" | "http_probe" | "cert_info" | "provider_status";

/** Matches `CheckView.status` once finished (TDD §6.3). */
export type CheckStatus = "pass" | "fail" | "error" | "unavailable";

/**
 * `ok` means the tool ran and produced evidence about the target (status pass or fail).
 * `error` is a refusal (SSRF, scope); `unavailable` means we couldn't check (rate limit, budget, resolver down).
 */
export type ToolResult<Raw = unknown> = {
  evidenceId: string;
  tool: ToolName;
  ok: boolean;
  status: CheckStatus;
  summary: string;
  /** Compact JSON for the LLM, at most `DIGEST_MAX` bytes. */
  digest: string;
  /** Full evidence for the UI (`getEvidence`); never sent to the LLM. */
  raw: Raw;
};

export type ToolContext = {
  fetch: Fetch;
  evidenceId: string;
  /** Dev-only SSRF exception (TDD §11). */
  allowOrigin?: string;
  /** Called before every probe sample; WP-17 backs it with PROBE_LIMIT. Returns false when limited. */
  rateLimit?: (host: string) => Promise<boolean>;
  now?: () => number;
};
