import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../env";
import { isId, newId } from "./ids";

/** Cookie name without its prefix; Hono adds `__Host-`, which forces Secure, Path=/ and no Domain. */
const WS_COOKIE = "ws";
const ONE_YEAR_S = 365 * 24 * 60 * 60;

export function readWorkspaceId(c: Context): string | undefined {
  const value = getCookie(c, WS_COOKIE, "host");
  return isId(value) ? value : undefined;
}

/** The workspace ID from a raw Cookie header: WebSocket upgrades reach the agent without Hono. */
export function workspaceFromCookieHeader(header: string | null): string | undefined {
  const value = /(?:^|;\s*)__Host-ws=([^;]*)/.exec(header ?? "")?.[1];
  return isId(value) ? value : undefined;
}

/**
 * Anonymous workspace identity (FR-8). A well-formed cookie is trusted without a D1 read; a forged ID
 * only creates a fresh, empty workspace. Missing or malformed cookies get a new workspace.
 */
export const workspace: MiddlewareHandler<AppEnv> = async (c, next) => {
  let id = readWorkspaceId(c);
  if (!id) {
    id = newId();
    await c.env.DB.prepare("INSERT OR IGNORE INTO workspaces (id, created_at) VALUES (?, ?)").bind(id, Date.now()).run();
    setCookie(c, WS_COOKIE, id, {
      prefix: "host",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: ONE_YEAR_S,
    });
  }
  c.set("workspaceId", id);
  await next();
};
