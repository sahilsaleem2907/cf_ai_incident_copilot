import { Hono } from "hono";
import type { AppEnv } from "../env";
import { budgetMode, d1Usage } from "../llm/usage";
import { ipKey, takeVoice } from "../safety/quota";
import { normalizeTranscript } from "../voice/normalize";

/** 30 s of 24 kbps Opus is about 90 KB; 160 KB leaves room for container overhead and other codecs (TDD §5.2). */
export const VOICE_MAX_BYTES = 160 * 1024;
export const WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo";
/** What the mock "hears" (LLM_MODE=mock): the WP-23 done-when phrase. */
export const MOCK_TRANSCRIPT = "is demo dot example dot com down";
/** Whisper turbo is about 47 neurons per audio minute (PRD §9). */
const NEURONS_PER_MINUTE = 47;
/** 24 kbps → 3,000 bytes a second, for the estimate when Whisper doesn't report the duration. */
const BYTES_PER_SECOND = 3000;
const WHISPER_TIMEOUT_MS = 20_000;

/** Reads the body up to `cap` bytes; null if it's bigger (the rest isn't read). */
async function readCapped(req: Request, cap: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return all;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * `POST /api/voice` (TDD §7.1, §8.7): one recording in, its text out. Checks in order: audio type, size, budget
 * guard, quota; then Whisper and normalisation. The text is only ever put in the input box (FR-61).
 */
export const voice = new Hono<AppEnv>().post("/", async (c) => {
  if (!/^audio\//i.test(c.req.header("content-type") ?? "")) return c.json({ error: "unsupported_type" }, 415);
  if (Number(c.req.header("content-length") ?? 0) > VOICE_MAX_BYTES) return c.json({ error: "too_large" }, 413);
  const audio = await readCapped(c.req.raw, VOICE_MAX_BYTES);
  if (audio === null) return c.json({ error: "too_large" }, 413);
  if (audio.byteLength === 0) return c.json({ error: "empty_audio" }, 400);

  const usage = d1Usage(c.env.DB);
  if ((await budgetMode(usage)) === "rule_based") return c.json({ error: "voice_unavailable" }, 503);
  const quota = await takeVoice(c.env, { workspaceId: c.get("workspaceId"), ip: await ipKey(c.req.header("CF-Connecting-IP")) });
  if (!quota.ok) return c.json({ error: "rate_limited", retryAfter: quota.retryAfter }, 429, { "Retry-After": String(quota.retryAfter) });

  if (c.env.LLM_MODE === "mock") return c.json({ text: normalizeTranscript(MOCK_TRANSCRIPT) });

  let out: { text?: string; transcription_info?: { duration?: number }; usage?: { neurons?: number } };
  try {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("whisper timed out")), WHISPER_TIMEOUT_MS)));
    out = await Promise.race([c.env.AI.run(WHISPER_MODEL, { audio: toBase64(audio) }, { gateway: { id: c.env.AI_GATEWAY_ID } }), timeout]).finally(() => timer !== null && clearTimeout(timer));
  } catch (e) {
    const message = (e as Error).message;
    console.error("whisper failed", message);
    if (/allocation/i.test(message)) await usage.exhausted();
    return c.json({ error: "transcribe_failed" }, 502);
  }
  const seconds = out.transcription_info?.duration ?? audio.byteLength / BYTES_PER_SECOND;
  await usage.add(out.usage?.neurons ?? (seconds / 60) * NEURONS_PER_MINUTE);
  return c.json({ text: normalizeTranscript(out.text ?? "") });
});
