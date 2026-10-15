import { cn } from "@cloudflare/kumo";
import { useEffect, useRef } from "react";
import type { MessageView } from "../../worker/agent/state";
import type { Evidence } from "../hooks/useIncident";
import type { FeedItem } from "../lib/feed";
import { ApprovalCard } from "./ApprovalCard";
import { CheckCard } from "./CheckCard";
import { Markdown } from "./Markdown";

type Props = {
  feed: FeedItem[];
  knownIds: ReadonlySet<string>;
  getEvidence: (id: string) => Promise<Evidence | null>;
  /** Owner only; viewers get cards without buttons. */
  onDecide?: (id: string, decision: "approve" | "reject") => Promise<unknown>;
};

/** The incident conversation: messages, check cards in run order, and the live narration (TDD §12.2). */
export function ChatPane({ feed, knownIds, getEvidence, onDecide }: Props) {
  const end = useRef<HTMLDivElement>(null);
  const last = feed.at(-1);
  const lastKey = last ? `${last.key}:${last.kind === "stream" ? last.text.length : ""}` : "";
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [lastKey]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-6">
      {feed.map((item) => {
        switch (item.kind) {
          case "message":
            return <MessageBubble key={item.key} message={item.message} knownIds={knownIds} />;
          case "check":
            return <CheckCard key={item.key} check={item.check} status={item.status} getEvidence={getEvidence} />;
          case "approval":
            return <ApprovalCard key={item.key} approval={item.approval} knownIds={knownIds} {...(onDecide ? { onDecide } : {})} />;
          case "stream":
            return (
              <div key={item.key} aria-live="polite" aria-busy="true" className="rounded-lg bg-(--cf-bg-200) p-4">
                <Markdown text={item.text || "…"} knownIds={knownIds} />
              </div>
            );
        }
      })}
      <div ref={end} />
    </div>
  );
}

export function MessageBubble({ message, knownIds }: { message: MessageView; knownIds: ReadonlySet<string> }) {
  if (message.role === "user") {
    return (
      <div className="ml-auto max-w-[85%] rounded-lg bg-(--cf-bg-300) px-4 py-2 whitespace-pre-wrap">
        <span className="sr-only">You: </span>
        {message.content}
      </div>
    );
  }
  return (
    <div
      className={cn(
        "rounded-lg p-4",
        message.role === "system" ? "border border-dashed border-(--cf-border) text-sm text-(--cf-fg-muted)" : "bg-(--cf-bg-200)",
      )}
    >
      <Markdown text={message.content} knownIds={knownIds} />
    </div>
  );
}
