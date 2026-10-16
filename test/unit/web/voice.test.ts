import { describe, expect, it } from "vitest";
import { micErrorText, pickMimeType } from "../../../web/hooks/useRecorder";
import { transcribe, VOICE_ERROR_TEXT } from "../../../web/lib/api";

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => (async () => new Response(JSON.stringify(body), { status, headers })) as unknown as typeof fetch;

describe("voice input (WP-23)", () => {
  it("picks Opus in WebM, then Ogg, then MP4 (Safari)", () => {
    expect(pickMimeType(() => true)).toBe("audio/webm;codecs=opus");
    expect(pickMimeType((t) => t.startsWith("audio/ogg"))).toBe("audio/ogg;codecs=opus");
    expect(pickMimeType((t) => t === "audio/mp4")).toBe("audio/mp4");
    expect(pickMimeType(() => false)).toBeNull();
  });

  it("explains microphone errors", () => {
    expect(micErrorText({ name: "NotAllowedError" })).toMatch(/blocked/);
    expect(micErrorText({ name: "NotFoundError" })).toBe("No microphone found.");
    expect(micErrorText(new Error("x"))).toBe("Couldn't start the microphone.");
  });

  it("sends the recording with its type and returns the text", async () => {
    let sent: RequestInit | undefined;
    const f = (async (_url: string, init?: RequestInit) => {
      sent = init;
      return Response.json({ text: "is demo.example.com down" });
    }) as unknown as typeof fetch;
    expect(await transcribe(new Blob(["x"], { type: "audio/webm" }), f)).toEqual({ ok: true, text: "is demo.example.com down" });
    expect(sent).toMatchObject({ method: "POST", headers: { "content-type": "audio/webm" } });
  });

  it("maps every refusal to words", async () => {
    expect(await transcribe(new Blob(["x"]), reply(429, { error: "rate_limited", retryAfter: 42 }))).toEqual({ ok: false, error: "rate_limited", retryAfter: 42 });
    expect(await transcribe(new Blob(["x"]), reply(413, { error: "too_large" }))).toEqual({ ok: false, error: "too_large" });
    expect(await transcribe(new Blob(["x"]), reply(503, { error: "voice_unavailable" }))).toEqual({ ok: false, error: "voice_unavailable" });
    expect(await transcribe(new Blob(["x"]), reply(500, { error: "weird" }))).toEqual({ ok: false, error: "server" });
    const down = (async () => Promise.reject(new TypeError("offline"))) as unknown as typeof fetch;
    expect(await transcribe(new Blob(["x"]), down)).toEqual({ ok: false, error: "network" });
    for (const text of Object.values(VOICE_ERROR_TEXT)) expect(text).toMatch(/\.$/);
  });
});
