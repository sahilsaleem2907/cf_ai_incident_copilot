import { DurableObject } from "cloudflare:workers";
import type { DemoMode } from "./modes";

/** One per workspace (`idFromName(ws)`): holds that workspace's demo mode. */
export class DemoState extends DurableObject {
  getMode(): DemoMode {
    return this.ctx.storage.kv.get<DemoMode>("mode") ?? "healthy";
  }

  setMode(mode: DemoMode): DemoMode {
    this.ctx.storage.kv.put("mode", mode);
    return mode;
  }
}
