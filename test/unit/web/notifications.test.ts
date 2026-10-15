import { describe, expect, it } from "vitest";
import { newlyUnread } from "../../../web/hooks/useIncidents";
import { notificationBody } from "../../../web/hooks/useNotifications";
import { getWebhook, removeWebhook, saveWebhook, testWebhook, type IncidentRow } from "../../../web/lib/api";

const row = (id: string, unread: boolean, over: Partial<IncidentRow> = {}): IncidentRow => ({
  id,
  target: "https://api.example.com/",
  status: "investigating",
  origin: "watch",
  unread,
  updatedAt: 0,
  ...over,
});

describe("newlyUnread (D16)", () => {
  it("announces nothing on the first load", () => {
    expect(newlyUnread(null, [row("a", true)])).toEqual([]);
  });

  it("announces rows that turned unread, and new unread rows, once", () => {
    const before = new Map([
      ["a", false],
      ["b", true],
    ]);
    const rows = [row("a", true), row("b", true), row("c", true), row("d", false)];
    expect(newlyUnread(before, rows).map((r) => r.id)).toEqual(["a", "c"]);
    expect(newlyUnread(new Map(rows.map((r) => [r.id, r.unread])), rows)).toEqual([]);
  });
});

describe("notificationBody", () => {
  it("says the host, the status in words, and whether a watch opened it", () => {
    expect(notificationBody(row("a", true))).toBe("api.example.com · Investigating (watch)");
    expect(notificationBody(row("a", true, { origin: "chat", status: "resolved" }))).toBe("api.example.com · Resolved");
  });
});

describe("webhook API client", () => {
  const fake = (status: number, body?: unknown) => (async () => new Response(body === undefined ? null : JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("maps results and errors", async () => {
    expect(await getWebhook(fake(200, { available: false, webhook: null }))).toEqual({ ok: true, value: { available: false, webhook: null } });
    expect(await saveWebhook("x", fake(400, { error: "invalid_webhook", message: "Only Slack…" }))).toEqual({ ok: false, error: "invalid_webhook", message: "Only Slack…" });
    expect(await saveWebhook("x", fake(503, { error: "webhooks_unavailable" }))).toEqual({ ok: false, error: "webhooks_unavailable" });
    expect(await testWebhook(fake(429, { error: "rate_limited", retryAfter: 60 }))).toEqual({ ok: false, error: "rate_limited" });
    expect(await testWebhook(fake(502, { error: "send_failed" }))).toEqual({ ok: false, error: "send_failed" });
    expect(await removeWebhook(fake(204))).toEqual({ ok: true, value: null });
    expect(await getWebhook(fake(500, { error: "boom" }))).toEqual({ ok: false, error: "server" });
  });
});
