import { Hono } from "hono";
import type { AppEnv } from "../env";
import { workspace } from "../lib/cookie";
import { demo } from "./demo";
import { health } from "./health";
import { incidents } from "./incidents";
import { session } from "./session";
import { watches } from "./watches";
import { webhook } from "./webhook";

export const api = new Hono<AppEnv>().basePath("/api");

// Health stays cookie-free so smoke tests and uptime checks don't mint workspaces.
api.route("/health", health);

api.use("*", workspace);
api.route("/session", session);
api.route("/incidents", incidents);
api.route("/demo", demo);
api.route("/watches", watches);
api.route("/webhook", webhook);

api.notFound((c) => c.json({ error: "not_found" }, 404));
