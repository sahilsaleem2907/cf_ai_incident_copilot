import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      /** Injected by vitest.config.ts for the integration project only. */
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
