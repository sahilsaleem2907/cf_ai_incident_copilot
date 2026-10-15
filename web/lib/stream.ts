import type { StreamFrame } from "../../worker/agent/state";

/** Live narration text per message, built from the agent's WebSocket side channel (TDD §6.3). */
export type StreamBuffer = { messageId: string; text: string; done: boolean };
export type Streams = Readonly<Record<string, StreamBuffer>>;

/** Our stream frames only; the SDK's own `cf_agent_*` and `rpc` frames return null. */
export function parseFrame(data: unknown): StreamFrame | null {
  if (typeof data !== "string") return null;
  let f: unknown;
  try {
    f = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof f !== "object" || f === null) return null;
  const { type, messageId, text } = f as Record<string, unknown>;
  if (typeof messageId !== "string") return null;
  if (type === "stream_start" || type === "stream_end") return { type, messageId };
  if (type === "delta" && typeof text === "string") return { type, messageId, text };
  return null;
}

/** `stream_start` resets (a retried narration streams again from the start). */
export function applyFrame(streams: Streams, f: StreamFrame): Streams {
  const current = streams[f.messageId];
  switch (f.type) {
    case "stream_start":
      return { ...streams, [f.messageId]: { messageId: f.messageId, text: "", done: false } };
    case "delta":
      return { ...streams, [f.messageId]: { messageId: f.messageId, text: (current?.text ?? "") + f.text, done: false } };
    case "stream_end":
      return current ? { ...streams, [f.messageId]: { ...current, done: true } } : streams;
  }
}
