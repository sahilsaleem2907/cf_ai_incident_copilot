import { useAgent } from "agents/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ConnectionRole, IncidentState, Json } from "../../worker/agent/state";
import { buildFeed } from "../lib/feed";
import { applyFrame, parseFrame, type Streams } from "../lib/stream";

export type Evidence = { evidenceId: string; tool: string; status: string; summary: string; raw: Json };

/**
 * One incident over the agent's WebSocket (TDD §12.3): synced state, the live narration buffer, the
 * caller's role, and the callables. The state comes only from the server (client writes are rejected).
 */
export function useIncident(id: string) {
  const [streams, setStreams] = useState<Streams>({});
  const [role, setRole] = useState<ConnectionRole | null>(null);
  const [notFound, setNotFound] = useState(false);

  const agent = useAgent<IncidentState>({
    agent: "incident-agent",
    name: id,
    onMessage: (e: MessageEvent) => {
      const frame = parseFrame(e.data);
      if (frame) setStreams((s) => applyFrame(s, frame));
    },
    onClose: (e: CloseEvent) => {
      // 4404: the agent has no such incident (closed in onConnect).
      if (e?.code === 4404) setNotFound(true);
    },
  });

  const state = agent.state?.id ? agent.state : null;

  useEffect(() => {
    if (!state) return;
    let live = true;
    agent
      .call("whoami")
      .then((r) => live && setRole((r as { role: ConnectionRole }).role))
      .catch(() => live && setRole("viewer"));
    return () => {
      live = false;
    };
    // Ask once the first state arrives; the role doesn't change for a connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!state]);

  const feed = useMemo(() => (state ? buildFeed(state, streams) : []), [state, streams]);

  const send = useCallback(async (text: string) => (await agent.call("sendMessage", [text])) as { runId: string }, [agent]);
  const getEvidence = useCallback(async (evidenceId: string) => (await agent.call("getEvidence", [evidenceId])) as Evidence | null, [agent]);
  const decide = useCallback(async (approvalId: string, decision: "approve" | "reject") => agent.call(decision, [approvalId]), [agent]);
  const resolve = useCallback(async () => agent.call("resolve"), [agent]);

  return { state, feed, role, notFound, send, getEvidence, decide, resolve };
}
