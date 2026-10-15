import { describe, expect, it } from "vitest";
import type { ApprovalView, CheckView, IncidentState, MessageView } from "../../../worker/agent/state";
import { cardState, whyText } from "../../../web/lib/approval";
import { buildFeed, workingLabel } from "../../../web/lib/feed";
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
const approval = (id: string, runId: string, createdAt: number, over: Partial<ApprovalView> = {}): ApprovalView => ({
  id,
  runId,
  actionId: "restore_demo_service",
  title: "Restore",
  status: "pending",
  cause: "The origin returns 500.",
  evidence: ["http-1"],
  createdAt,
  ...over,
});
const state = (p: Partial<IncidentState>) => ({ messages: [], checks: [], activeRunId: null, approvals: [], ...p });
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

describe("approval cards", () => {
  it("follow their run's narration, and survive a narration that left the message window", () => {
    const feed = buildFeed(
      state({
        messages: [msg("u1", "run-1", "user", 1), msg("narr-run-1", "run-1", "assistant", 5), msg("u2", "run-2", "user", 6), msg("narr-run-2", "run-2", "assistant", 9)],
        approvals: [approval("a2", "run-2", 10), approval("a1", "run-1", 6, { status: "superseded" }), approval("a0", "run-0", 0, { status: "expired" })],
      }),
      {},
    );
    expect(keys(feed)).toEqual(["msg-u1", "msg-narr-run-1", "approval-a1", "msg-u2", "msg-narr-run-2", "approval-a2", "approval-a0"]);
  });

  it("say their state in words", () => {
    expect(cardState({ status: "pending" }).text).toBe("Waiting for your approval");
    expect(cardState({ status: "approved" })).toEqual({ text: "Approved, working on it…", tone: "working" });
    expect(cardState({ status: "approved", outcome: { ok: true, text: "" } })).toEqual({ text: "Approved, checking it…", tone: "working" });
    expect(cardState({ status: "approved", outcome: { ok: true, text: "", verified: true } })).toEqual({ text: "Approved and verified", tone: "good" });
    expect(cardState({ status: "approved", outcome: { ok: false, text: "", verified: false } }).text).toBe("Approved, but still failing");
    expect(cardState({ status: "approved", outcome: { ok: false, text: "" } }).text).toBe("Approved, but the action failed");
    expect(cardState({ status: "expired" }).text).toBe("Expired, no action taken");
    expect(cardState({ status: "superseded" }).tone).toBe("closed");
  });

  it("cite the evidence in the why", () => {
    expect(whyText({ cause: "The origin returns 500.", evidence: ["http-1", "dns-1"] })).toBe("The origin returns 500 [http-1] [dns-1].");
    expect(whyText({ cause: "Cited already [http-1].", evidence: ["http-1"] })).toBe("Cited already [http-1].");
  });
});

describe("workingLabel (chat loading row)", () => {
  const sent = buildFeed(state({ messages: [msg("u1", "run-1", "user", 1)], activeRunId: "run-1" }), {});
  const checking = buildFeed(state({ messages: [msg("u1", "run-1", "user", 1)], checks: [check("http-1", "run-1", "pending")], activeRunId: "run-1" }), {});
  const checked = buildFeed(state({ messages: [msg("u1", "run-1", "user", 1)], checks: [check("http-1", "run-1")], activeRunId: "run-1" }), {});
  const empty = buildFeed(state({ messages: [msg("u1", "run-1", "user", 1)], checks: [check("http-1", "run-1")], activeRunId: "run-1" }), {
    "narr-run-1": { messageId: "narr-run-1", text: "", done: false },
  });
  const writing = buildFeed(state({ messages: [msg("u1", "run-1", "user", 1)], checks: [check("http-1", "run-1")], activeRunId: "run-1" }), {
    "narr-run-1": { messageId: "narr-run-1", text: "**Likely", done: false },
  });

  it("says nothing when no run is active", () => {
    expect(workingLabel(checking, false)).toBeNull();
  });

  it("runs checks first, then writes the diagnosis, then lets the text speak", () => {
    expect(workingLabel(sent, true)).toBe("Running checks…");
    expect(workingLabel(checking, true)).toBe("Running checks…");
    expect(workingLabel(checked, true)).toBe("Writing the diagnosis…");
    expect(workingLabel(empty, true)).toBe("Writing the diagnosis…");
    expect(workingLabel(writing, true)).toBeNull();
  });

  it("ignores a finished run's leftover pending check", () => {
    const feed = buildFeed(state({ messages: [msg("u1", "run-1", "user", 1), msg("narr-run-1", "run-1", "assistant", 2)], checks: [check("http-1", "run-9", "pending")], activeRunId: "run-2" }), {});
    expect(workingLabel(feed, true)).toBe("Writing the diagnosis…");
  });
});
