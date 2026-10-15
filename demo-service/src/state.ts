import { DurableObject } from "cloudflare:workers";
import type { DemoMode } from "./modes";

/** One per workspace (`idFromName(ws)`): holds that workspace's demo modes, already validated by DemoAdmin. */
export class DemoState extends DurableObject {
  getModes(): DemoMode[] {
    return this.ctx.storage.kv.get<DemoMode[]>("modes") ?? ["healthy"];
  }

  setModes(modes: DemoMode[]): DemoMode[] {
    this.ctx.storage.kv.put("modes", modes);
    return modes;
  }
}
