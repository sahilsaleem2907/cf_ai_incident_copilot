import { describe, expect, it } from "vitest";
import type { CheckView, IncidentState, MessageView } from "../../../worker/agent/state";
import { buildFeed } from "../../../web/lib/feed";
import { applyFrame, parseFrame, type Streams } from "../../../web/lib/stream";

describe("stream frames", () => {
  it("parses only our stream frames", () => {
    expect(parseFrame('{"type":"delta","messageId":"narr-run-1","text":"Hi"}')).toEqual({ type: "delta", messageId: "narr-run-1", text: "Hi" });
    expect(parseFrame('{"type":"stream_end","messageId":"narr-run-1"}')).toEqual({ type: "stream_end", messageId: "narr-run-1" });
    expect(parseFrame('{"type":"cf_agent_state","state":{}}')).toBeNull();
    expect(parseFrame('{"type":"rpc","id":"1"}')).toBeNull();
    expect(parseFrame("not json")).toBeNull();
    expect(parseFrame(new ArrayBuffer(2))).toBeNull();
  });

  it("appends deltas, restarts on stream_start and marks the end", () => {
    let s: Streams = {};
    s = applyFrame(s, { type: "stream_start", messageId: "m" });
    s = applyFrame(s, { type: "delta", messageId: "m", text: "Hel" });
    s = applyFrame(s, { type: "delta", messageId: "m", text: "lo" });
    expect(s.m).toEqual({ messageId: "m", text: "Hello", done: false });
    s = applyFrame(s, { type: "stream_start", messageId: "m" });
    expect(s.m!.text).toBe("");
    s = applyFrame(s, { type: "delta", messageId: "m", text: "Again" });
    s = applyFrame(s, { type: "stream_end", messageId: "m" });
    expect(s.m).toEqual({ messageId: "m", text: "Again", done: true });
  });
});

const msg = (id: string, runId: string | null, role: MessageView["role"], t: number): MessageView => ({ id, runId, role, content: id, createdAt: t });
const check = (evidenceId: string, runId: string, status: CheckView["status"] = "pass"): CheckView => ({ evidenceId, runId, tool: "http_probe", label: "HTTP probe", status, summary: "", startedAt: 0 });
const state = (p: Partial<IncidentState>) => ({ messages: [], checks: [], activeRunId: null, ...p });
const keys = (items: ReturnType<typeof buildFeed>) => items.map((i) => i.key);

describe("buildFeed", () => {
  it("puts each run's checks under its question and before its narration", () => {
    const feed = buildFeed(
      state({
        messages: [msg("u1", "run-1", "user", 1), msg("narr-run-1", "run-1", "assistant", 5), msg("u2", "run-2", "user", 6), msg("narr-run-2", "run-2", "assistant", 9)],
        checks: [check("dns-1", "run-1"), check("http-1", "run-1"), check("http-2", "run-2")],
      }),
      {},
    );
    expect(keys(feed)).toEqual(["msg-u1", "check-dns-1", "check-http-1", "msg-narr-run-1", "msg-u2", "check-http-2", "msg-narr-run-2"]);
  });

  it("shows pending checks of the active run as running, and the live narration after the checks", () => {
    const feed = buildFeed(state({ messages: [msg("u1", "run-1", "user", 1)], checks: [check("http-1", "run-1", "pending")], activeRunId: "run-1" }), {
      "narr-run-1": { messageId: "narr-run-1", text: "**Likely", done: false },
    });
    expect(feed.map((i) => i.kind)).toEqual(["message", "check", "stream"]);
    expect(feed[1]).toMatchObject({ kind: "check", status: "running" });
    expect(feed[2]).toMatchObject({ kind: "stream", text: "**Likely" });
  });

  it("replaces the stream with the stored narration", () => {
    const feed = buildFeed(state({ messages: [msg("u1", "run-1", "user", 1), msg("narr-run-1", "run-1", "assistant", 2)] }), {
      "narr-run-1": { messageId: "narr-run-1", text: "partial", done: true },
    });
    expect(keys(feed)).toEqual(["msg-u1", "msg-narr-run-1"]);
  });

  it("keeps a pending check of a finished run as pending, and shows orphan checks at the end", () => {
    const feed = buildFeed(state({ messages: [msg("sys", null, "system", 0)], checks: [check("http-1", "run-9", "pending")] }), {});
    expect(feed).toEqual([expect.objectContaining({ key: "msg-sys" }), expect.objectContaining({ key: "check-http-1", status: "pending" })]);
  });
});
