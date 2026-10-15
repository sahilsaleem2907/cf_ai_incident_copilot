import { describe, expect, it } from "vitest";
import { decryptUrl, encryptUrl, webhookKey } from "../../worker/notify/crypto";
import { formatMessage, maskUrl, parseWebhookUrl, RetryableSendError, sendWebhook } from "../../worker/notify/webhook";

const KEY_B64 = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i)));
const DISCORD = "https://discord.com/api/webhooks/123456/abcDEFtoken";
const SLACK = "https://hooks.slack.com/services/T000/B000/XXXXsecret";

describe("parseWebhookUrl (FR-52)", () => {
  it("accepts Slack and Discord webhook URLs only", () => {
    expect(parseWebhookUrl(SLACK)).toMatchObject({ ok: true, kind: "slack" });
    expect(parseWebhookUrl(DISCORD)).toMatchObject({ ok: true, kind: "discord" });
    expect(parseWebhookUrl("https://discordapp.com/api/webhooks/1/x")).toMatchObject({ ok: true, kind: "discord" });
  });

  it("refuses everything else", () => {
    for (const bad of [
      "",
      "not a url",
      "http://hooks.slack.com/services/x",
      "https://discord.com/channels/1/2",
      "https://evil.example.com/api/webhooks/1/x",
      "https://hooks.slack.com.evil.example.com/services/x",
      "https://hooks.slack.com/",
      "https://user:pw@hooks.slack.com/services/x",
      "https://hooks.slack.com:8443/services/x",
      `https://hooks.slack.com/services/${"x".repeat(600)}`,
    ]) {
      expect(parseWebhookUrl(bad), bad).toMatchObject({ ok: false, message: expect.any(String) });
    }
  });
});

describe("maskUrl (FR-53)", () => {
  it("keeps the host and the last 4 characters only", () => {
    expect(maskUrl(DISCORD)).toBe("discord.com/…/••••oken");
    expect(maskUrl(SLACK)).toBe("hooks.slack.com/…/••••cret");
    expect(maskUrl(SLACK)).not.toContain("T000");
  });
});

describe("AES-GCM (FR-53)", () => {
  it("round-trips, and only for the same workspace", async () => {
    const key = (await webhookKey({ WEBHOOK_KEY: KEY_B64 }))!;
    const sealed = await encryptUrl(key, DISCORD, "ws-a");
    expect(sealed.iv).toHaveLength(12);
    expect(new TextDecoder().decode(sealed.ciphertext)).not.toContain("discord");
    expect(await decryptUrl(key, sealed, "ws-a")).toBe(DISCORD);
    await expect(decryptUrl(key, sealed, "ws-b")).rejects.toThrow();
    // A new IV every time.
    expect((await encryptUrl(key, DISCORD, "ws-a")).iv).not.toEqual(sealed.iv);
  });

  it("is off without a valid 32-byte key", async () => {
    expect(await webhookKey({})).toBeNull();
    expect(await webhookKey({ WEBHOOK_KEY: "" })).toBeNull();
    expect(await webhookKey({ WEBHOOK_KEY: btoa("too short") })).toBeNull();
    expect(await webhookKey({ WEBHOOK_KEY: "%%%not base64%%%" })).toBeNull();
  });
});

describe("formatMessage", () => {
  const opened = { event: "opened" as const, target: "https://api.example.com/", category: "origin_5xx" as const, cause: "The origin returns 500 [http-1].", link: "https://app.example.dev/i/abc" };

  it("Discord gets {content}, Slack gets {text}, each in its own bold syntax", () => {
    expect(formatMessage("discord", opened)).toEqual({
      content: "🔴 **Watch alert: api.example.com is failing**. An incident was opened and diagnosed.\nLikely cause (origin 5xx): The origin returns 500.\nhttps://app.example.dev/i/abc",
    });
    expect((formatMessage("slack", opened) as { text: string }).text).toMatch(/^🔴 \*Watch alert: api\.example\.com is failing\*/);
  });

  it("words recovery, resolution, an inconclusive diagnosis and a missing link", () => {
    const text = (m: Parameters<typeof formatMessage>[1]) => (formatMessage("discord", m) as { content: string }).content;
    expect(text({ event: "mitigated", target: "https://api.example.com/" })).toMatch(/is recovering\*\*: a check passed/);
    expect(text({ event: "resolved", target: "https://api.example.com/", link: "L" })).toMatch(/is resolved\*\*: 3 passing checks in a row\.\nL$/);
    expect(text({ ...opened, category: "inconclusive" })).toContain("inconclusive");
    expect(text({ event: "test", target: "" })).toContain("this webhook works");
  });
});

describe("sendWebhook", () => {
  const answer = (status: number) => (async () => new Response(null, { status })) as unknown as typeof fetch;

  it("2xx is sent; a 4xx is final; 429, 5xx and network errors are retried", async () => {
    expect(await sendWebhook(DISCORD, {}, answer(204))).toEqual({ sent: true });
    expect(await sendWebhook(DISCORD, {}, answer(404))).toEqual({ sent: false, permanent: true, status: 404 });
    await expect(sendWebhook(DISCORD, {}, answer(429))).rejects.toBeInstanceOf(RetryableSendError);
    await expect(sendWebhook(DISCORD, {}, answer(503))).rejects.toBeInstanceOf(RetryableSendError);
    const offline = (async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;
    await expect(sendWebhook(DISCORD, {}, offline)).rejects.toBeInstanceOf(RetryableSendError);
  });

  it("never follows a redirect", async () => {
    let init: RequestInit | undefined;
    await sendWebhook(DISCORD, { content: "x" }, (async (_: string, i?: RequestInit) => ((init = i), new Response(null, { status: 302 }))) as unknown as typeof fetch);
    expect(init).toMatchObject({ method: "POST", redirect: "manual" });
  });
});
