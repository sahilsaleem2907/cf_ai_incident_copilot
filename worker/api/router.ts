import { Hono } from "hono";
import type { AppEnv } from "../env";
import { workspace } from "../lib/cookie";
import { health } from "./health";
import { session } from "./session";

export const api = new Hono<AppEnv>().basePath("/api");

// Health stays cookie-free so smoke tests and uptime checks don't mint workspaces.
api.route("/health", health);

api.use("*", workspace);
api.route("/session", session);

api.notFound((c) => c.json({ error: "not_found" }, 404));
