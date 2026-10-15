import { describe, expect, it } from "vitest";
import { workspaceFromCookieHeader } from "../../worker/lib/cookie";

const ID = "0123456789abcdef0123456789abcdef";

/** WebSocket upgrades reach the agent without Hono, so the agent reads the raw Cookie header. */
describe("workspaceFromCookieHeader", () => {
  it("reads the __Host-ws cookie wherever it sits in the header", () => {
    expect(workspaceFromCookieHeader(`__Host-ws=${ID}`)).toBe(ID);
    expect(workspaceFromCookieHeader(`a=1; __Host-ws=${ID}; b=2`)).toBe(ID);
    expect(workspaceFromCookieHeader(`a=1;__Host-ws=${ID}`)).toBe(ID);
  });

  it("returns nothing for a missing header or cookie", () => {
    expect(workspaceFromCookieHeader(null)).toBeUndefined();
    expect(workspaceFromCookieHeader("")).toBeUndefined();
    expect(workspaceFromCookieHeader("a=1; b=2")).toBeUndefined();
  });

  it("ignores the cookie without its __Host- prefix, or under a longer name", () => {
    expect(workspaceFromCookieHeader(`ws=${ID}`)).toBeUndefined();
    expect(workspaceFromCookieHeader(`x__Host-ws=${ID}`)).toBeUndefined();
  });

  it("ignores a malformed workspace ID", () => {
    expect(workspaceFromCookieHeader("__Host-ws=abc")).toBeUndefined();
    expect(workspaceFromCookieHeader(`__Host-ws=${ID.toUpperCase()}`)).toBeUndefined();
    expect(workspaceFromCookieHeader(`__Host-ws=${ID}0`)).toBeUndefined();
  });
});
