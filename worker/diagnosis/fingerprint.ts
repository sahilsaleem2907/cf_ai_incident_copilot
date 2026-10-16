import type { Provider } from "./categories";

export type Fingerprint = { provider: Provider; via: "http" | "dns" };

/**
 * Which hosting provider a target looks like it runs on (TDD §9.3 rule 5): `server`/`cf-ray` for Cloudflare,
 * a `*.github.io` CNAME for GitHub Pages, an `amazonaws` CNAME for AWS. Shared by the rules and by the
 * automatic `provider_status` check (WP-21).
 */
export function fingerprint(headers: { server?: string; "cf-ray"?: string }, cnames: readonly string[]): Fingerprint[] {
  const out: Fingerprint[] = [];
  if (/cloudflare/i.test(headers.server ?? "") || headers["cf-ray"]) out.push({ provider: "cloudflare", via: "http" });
  if (cnames.some((c) => c.endsWith(".github.io"))) out.push({ provider: "github", via: "dns" });
  if (cnames.some((c) => c.includes("amazonaws"))) out.push({ provider: "aws", via: "dns" });
  return out;
}
