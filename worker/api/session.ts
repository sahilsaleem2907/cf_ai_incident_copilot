import { Hono } from "hono";
import type { AppEnv } from "../env";
import { LIMITS } from "../lib/limits";

export function demoUrlFor(baseUrl: string, workspaceId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/w/${workspaceId}/`;
}

export const session = new Hono<AppEnv>().get("/", (c) =>
  c.json({
    demoUrl: demoUrlFor(c.env.DEMO_BASE_URL, c.get("workspaceId")),
    // WP-17 wires this to the neuron budget guard (TDD §11).
    budgetMode: "ai" as "ai" | "rule_based",
    limits: LIMITS,
  }),
);
