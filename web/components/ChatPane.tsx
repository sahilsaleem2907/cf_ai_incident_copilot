import { cn } from "@cloudflare/kumo";
import { useEffect, useRef } from "react";
import type { MessageView } from "../../worker/agent/state";
import type { Evidence } from "../hooks/useIncident";
import { workingLabel, type FeedItem } from "../lib/feed";
import { ApprovalCard } from "./ApprovalCard";
import { CheckCard } from "./CheckCard";
import { DashedLoader } from "./DashedLoader";
import { Markdown } from "./Markdown";

type Props = {
  feed: FeedItem[];
  knownIds: ReadonlySet<string>;
  getEvidence: (id: string) => Promise<Evidence | null>;
  /** Owner only; viewers get cards without buttons. */
  onDecide?: (id: string, decision: "approve" | "reject") => Promise<unknown>;
  /** A run is active: show what it's doing at the end of the feed. */
  working?: boolean;
};

/** Within this many px of the bottom counts as "at the bottom", so new text keeps following. */
const PIN_SLACK = 80;

/** The incident conversation: messages, check cards in run order, and the live narration (TDD §12.2). */
export function ChatPane({ feed, knownIds, getEvidence, onDecide, working = false }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const last = feed.at(-1);
  const label = workingLabel(feed, working);
  const lastKey = last ? `${last.key}:${last.kind === "stream" ? last.text.length : ""}:${label ?? ""}` : "";

  // Follow new content only while the reader is at the bottom; scrolling up to read stops it.
  useEffect(() => {
    const scroller = root.current?.closest("main");
    if (!scroller) return;
    const onScroll = () => {
      pinned.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < PIN_SLACK;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);

  // Scrolls <main> only. scrollIntoView would also scroll every ancestor (the shell, the page) and move the footer.
  useEffect(() => {
    const scroller = root.current?.closest("main");
    const justSent = last?.kind === "message" && last.message.role === "user";
    if (scroller && (pinned.current || justSent)) {
      scroller.scrollTop = scroller.scrollHeight;
      pinned.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lastKey captures every change worth following
  }, [lastKey]);

  return (
    <div ref={root} className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-3 px-4 py-6">
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
                {item.text ? <Markdown text={item.text} knownIds={knownIds} /> : <DashedLoader label="Writing" />}
              </div>
            );
        }
      })}
      {label && (
        <p data-working className="flex items-center gap-2 px-1 text-sm text-(--cf-fg-muted)" aria-live="polite">
          <DashedLoader label={null} />
          {label}
        </p>
      )}
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
