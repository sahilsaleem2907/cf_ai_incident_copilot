import { exports } from "cloudflare:workers";

export type Frame = { type: string; [k: string]: unknown };

/** A raw agent WebSocket that speaks the SDK's frames: `cf_agent_state`, `rpc`, plus our stream frames. */
export async function connect(incidentId: string, workspaceId?: string, headers: Record<string, string> = {}) {
  const res = await exports.default.fetch(`https://copilot.example.com/agents/incident-agent/${incidentId}`, {
    headers: { Upgrade: "websocket", ...(workspaceId ? { Cookie: `__Host-ws=${workspaceId}` } : {}), ...headers },
  });
  if (res.status !== 101 || !res.webSocket) throw new Error(`upgrade failed: ${res.status}`);
  const ws = res.webSocket;
  ws.accept();
  const frames: Frame[] = [];
  const waiters: { match: (f: Frame) => boolean; resolve: (f: Frame) => void }[] = [];
  let closed: { code: number; reason: string } | null = null;
  ws.addEventListener("message", (e) => {
    const frame = JSON.parse(String(e.data)) as Frame;
    frames.push(frame);
    for (const w of [...waiters]) {
      if (w.match(frame)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(frame);
      }
    }
  });
  ws.addEventListener("close", (e) => {
    closed = { code: e.code, reason: e.reason };
  });

  const next = (match: (f: Frame) => boolean, ms = 3000) =>
    new Promise<Frame>((resolve, reject) => {
      const seen = frames.find(match);
      if (seen) return resolve(seen);
      const timer = setTimeout(() => reject(new Error("timed out waiting for a frame")), ms);
      waiters.push({ match, resolve: (f) => (clearTimeout(timer), resolve(f)) });
    });

  let n = 0;
  return {
    frames,
    closed: () => closed,
    /** Resolves with `{success, result | error}`. */
    rpc: async (method: string, args: unknown[] = []) => {
      const id = `t${++n}`;
      ws.send(JSON.stringify({ type: "rpc", id, method, args }));
      return (await next((f) => f.type === "rpc" && f.id === id)) as Frame & { success: boolean; result?: unknown; error?: string };
    },
    send: (frame: unknown) => ws.send(JSON.stringify(frame)),
    next,
    /** The latest synced state (the SDK sends it on connect and after every change). */
    state: async () => (await next((f) => f.type === "cf_agent_state")).state as Record<string, unknown>,
    close: () => ws.close(1000, "done"),
  };
}
